import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { closeServer } from './e2e/harness.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const CHROME =
  process.env.TP_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'translate-plugin-lifecycle-'))
const fixturePath = path.join(tempDirectory, 'lifecycle.png')
const requests = []
let lastCaptureAt = 0

const pageHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>截图生命周期测试</title><style>
html,body{margin:0;width:100%;height:100%;background:#f7f7f7}
#fixture{position:fixed;left:80px;top:100px;width:360px;height:240px;background:rgb(30,80,220)}
</style></head><body><div id="fixture"></div></body></html>`

const server = http.createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(pageHtml)
    return
  }

  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk) => (body += chunk))
  request.on('end', () => {
    const record = { body: JSON.parse(body), closed: false }
    requests.push(record)
    response.on('close', () => (record.closed = true))
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    response.flushHeaders()
    response.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: `EN>ZH\n任务 ${requests.length}` } }] })}\n\n`,
    )
  })
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}`
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: process.env.TP_HEADLESS === '0' ? false : true,
  pipe: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check'],
})

try {
  const cdp = await browser.target().createCDPSession()
  const { id: extensionId } = await cdp.send('Extensions.loadUnpacked', { path: DIST })
  const extensionOrigin = `chrome-extension://${extensionId}`
  const workerTarget = await browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().startsWith(extensionOrigin),
    { timeout: 20_000 },
  )
  const worker = await workerTarget.worker()
  assert(worker)
  await worker.evaluate(
    async (settings) => chrome.storage.local.set({ settings }),
    {
      baseUrl,
      apiKey: 'e2e-key',
      model: 'text-model',
      imageModel: 'deterministic-image-model',
      imagePrivacyAccepted: true,
      autoReadClipboard: false,
    },
  )

  const firstTab = await openFixturePage(browser, baseUrl)
  const secondTab = await openFixturePage(browser, baseUrl)
  const fixtureDataUrl = await firstTab.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 400
    canvas.height = 200
    const context = canvas.getContext('2d')
    context.fillStyle = 'rgb(220, 30, 30)'
    context.fillRect(0, 0, 200, 200)
    context.fillStyle = 'rgb(30, 80, 220)'
    context.fillRect(200, 0, 200, 200)
    return canvas.toDataURL('image/png')
  })
  fs.writeFileSync(fixturePath, Buffer.from(fixtureDataUrl.split(',')[1], 'base64'))

  await submitScreenshot(browser, worker, extensionOrigin, firstTab)
  await waitForRequestCount(1)
  await firstTab.waitForFunction(() => window.__findTranslationCard()?.result === '任务 1')

  await beginScreenshot(browser, worker, extensionOrigin, firstTab)
  await firstTab.waitForFunction(() => !window.__findTranslationCard())
  await waitForClosed(0)
  assert.equal(requests.length, 1, 'starting a replacement must not submit before confirmation')
  await confirmScreenshot(firstTab)
  await waitForRequestCount(2)
  await firstTab.waitForFunction(() => window.__findTranslationCard()?.result === '任务 2')

  await submitScreenshot(browser, worker, extensionOrigin, secondTab)
  await waitForRequestCount(3)
  await secondTab.waitForFunction(() => window.__findTranslationCard()?.result === '任务 3')
  assert.equal(requests[1].closed, false, 'a screenshot in another tab must not cancel the first tab')

  await clickCardButton(firstTab, '关闭截图翻译')
  await waitForClosed(1)
  assert.equal(requests[2].closed, false, 'closing one tab card must not cancel another tab')
  await firstTab.reload({ waitUntil: 'load' })
  await installPageHelpers(firstTab)
  assert.equal(await firstTab.evaluate(() => window.__findTranslationCard()), null)

  const workspace = await openWorkspace(browser, worker, extensionOrigin, secondTab)
  const fileInput = await workspace.$('#fileInput')
  assert(fileInput)
  await fileInput.uploadFile(fixturePath)
  await workspace.waitForFunction(() => document.querySelector('#sourceImage')?.naturalWidth > 0)
  await workspace.click('#translate')
  await waitForRequestCount(4)
  await workspace.waitForFunction(() => document.querySelector('#result')?.textContent === '任务 4')
  assert.equal(requests[2].closed, false, 'workspace translation must not cancel a web tab')

  await workspace.click('#clear')
  await waitForClosed(3)
  assert.equal(requests[2].closed, false, 'clearing a workspace must not cancel a web tab')
  assert.equal(await workspace.$eval('#sourceImage', (image) => image.hasAttribute('src')), false)
  await workspace.reload({ waitUntil: 'load' })
  assert.equal(await workspace.$eval('#sourceImage', (image) => image.hasAttribute('src')), false)
  assert.equal(new URL(workspace.url()).search, '')

  const reloadedInput = await workspace.$('#fileInput')
  assert(reloadedInput)
  await reloadedInput.uploadFile(fixturePath)
  await workspace.waitForFunction(() => document.querySelector('#sourceImage')?.naturalWidth > 0)
  await workspace.click('#translate')
  await waitForRequestCount(5)
  await workspace.close()
  await waitForClosed(4)
  assert.equal(requests[2].closed, false, 'closing a workspace must not cancel a web tab')

  const freshWorkspace = await openWorkspace(browser, worker, extensionOrigin, secondTab)
  assert.equal(await freshWorkspace.$eval('#sourceImage', (image) => image.hasAttribute('src')), false)
  const browserStorage = await freshWorkspace.evaluate(async () => ({
    localStorage: Object.values(localStorage),
    cacheNames: await caches.keys(),
    databases: typeof indexedDB.databases === 'function'
      ? (await indexedDB.databases()).map((database) => database.name)
      : [],
  }))
  assert.deepEqual(browserStorage, { localStorage: [], cacheNames: [], databases: [] })
  const extensionStorage = await worker.evaluate(async () => chrome.storage.local.get(null))
  assert.equal(JSON.stringify(extensionStorage).includes('data:image/'), false)

  await clickCardButton(secondTab, '关闭截图翻译')
  await waitForClosed(2)
  await secondTab.reload({ waitUntil: 'load' })
  await installPageHelpers(secondTab)
  assert.equal(await secondTab.evaluate(() => window.__findTranslationCard()), null)

  console.log(JSON.stringify({
    ok: true,
    sameTabReplacement: true,
    crossTabParallel: true,
    workspaceIsolation: true,
    cancellation: ['replacement', 'card-close', 'workspace-clear', 'workspace-close'],
    imageUnrecoverable: ['card-reload', 'workspace-reload', 'fresh-workspace', 'extension-storage'],
  }))
} finally {
  await browser.close()
  await closeServer(server)
  fs.rmSync(tempDirectory, { recursive: true, force: true })
}

async function openFixturePage(browser, baseUrl) {
  const page = await browser.newPage()
  await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 1 })
  await page.goto(baseUrl, { waitUntil: 'load' })
  await installPageHelpers(page)
  return page
}

async function submitScreenshot(browser, worker, extensionOrigin, page) {
  await beginScreenshot(browser, worker, extensionOrigin, page)
  await confirmScreenshot(page)
}

async function beginScreenshot(browser, worker, extensionOrigin, page) {
  const delay = 600 - (Date.now() - lastCaptureAt)
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
  await page.bringToFront()
  const popup = await openPopup(browser, worker, extensionOrigin)
  lastCaptureAt = Date.now()
  await popup.click('#screenshot')
  await page.waitForFunction(() => window.__findScreenshotDialog(), { timeout: 10_000 })
}

async function confirmScreenshot(page) {
  await drag(page, 100, 130, 300, 300)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !window.__findScreenshotDialog())
}

async function openWorkspace(browser, worker, extensionOrigin, activePage) {
  await activePage.bringToFront()
  const popup = await openPopup(browser, worker, extensionOrigin)
  const existing = new Set(browser.targets())
  await popup.click('#import')
  const target = await browser.waitForTarget(
    (candidate) =>
      !existing.has(candidate) &&
      candidate.url().startsWith(`${extensionOrigin}/src/workspace/index.html`),
    { timeout: 10_000 },
  )
  const workspace = await target.page()
  assert(workspace)
  await workspace.waitForSelector('#fileInput')
  return workspace
}

async function openPopup(browser, worker, extensionOrigin) {
  const existing = new Set(browser.targets())
  await worker.evaluate(async () => chrome.action.openPopup())
  const target = await browser.waitForTarget(
    (candidate) => !existing.has(candidate) && candidate.url() === `${extensionOrigin}/src/popup/index.html`,
    { timeout: 10_000 },
  )
  const popup = await target.asPage()
  await popup.waitForSelector('#screenshot')
  return popup
}

async function clickCardButton(page, label) {
  await page.evaluate((text) => {
    const button = [...window.__findScreenshotCard().querySelectorAll('button')].find((candidate) =>
      candidate.textContent === text || candidate.getAttribute('aria-label') === text,
    )
    button.click()
  }, label)
}

async function drag(page, fromX, fromY, toX, toY) {
  await page.mouse.move(fromX, fromY)
  await page.mouse.down()
  await page.mouse.move(toX, toY, { steps: 8 })
  await page.mouse.up()
}

async function waitForRequestCount(count) {
  const deadline = Date.now() + 10_000
  while (requests.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.equal(requests.length, count)
}

async function waitForClosed(index) {
  const deadline = Date.now() + 10_000
  while (!requests[index]?.closed && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.equal(requests[index]?.closed, true, `request ${index + 1} should be aborted`)
}

async function installPageHelpers(page) {
  await page.evaluate(() => {
    window.__findScreenshotDialog = () => {
      for (const host of document.documentElement.children) {
        const dialog = host.shadowRoot?.querySelector('[role="dialog"][aria-label="截图翻译框选"]')
        if (dialog) return dialog
      }
      return null
    }
    window.__findTranslationCard = () => {
      const card = window.__findScreenshotCard()
      if (!card) return null
      return { result: card.querySelector('[role="status"]')?.textContent }
    }
    window.__findScreenshotCard = () => {
      for (const host of document.documentElement.children) {
        const card = host.shadowRoot?.querySelector('[role="dialog"][aria-label="截图翻译结果"]')
        if (card) return card
      }
      return null
    }
  })
}
