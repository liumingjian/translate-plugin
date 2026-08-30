import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const CHROME =
  process.env.TP_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'translate-plugin-workspace-'))
const fixturePath = path.join(tempDirectory, 'whole-image.png')
fs.writeFileSync(fixturePath, PNG)

const requests = []
const server = http.createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>fixture</title><h1>Restricted fallback fixture</h1>')
    return
  }

  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk) => (body += chunk))
  request.on('end', () => {
    requests.push(JSON.parse(body))
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    response.flushHeaders()
    response.write(
      'data: {"choices":[{"delta":{"content":"EN>ZH\\n第一段"}}]}\n\n',
    )
    setTimeout(() => {
      response.write('data: {"choices":[{"delta":{"content":"第二段"}}]}\n\n')
      response.end('data: [DONE]\n\n')
    }, 1_500)
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
  // 扩展安装前已打开的页面没有 content script，稳定复现顶层框架无法承载截图 UI。
  // headless 的 chrome.action.openPopup() 不会授予 activeTab，因此测试构建临时使用
  // <all_urls> 完成真实 captureVisibleTab；本地服务另有 localhost 权限。生产构建均不含。
  const restrictedFixture = await browser.newPage()
  await restrictedFixture.goto(baseUrl, { waitUntil: 'load' })

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
      imagePrivacyAccepted: false,
      autoReadClipboard: false,
    },
  )

  await restrictedFixture.bringToFront()

  const openPopup = async () => {
    const existing = new Set(browser.targets())
    await worker.evaluate(async () => chrome.action.openPopup())
    const target = await browser.waitForTarget(
      (candidate) =>
        !existing.has(candidate) && candidate.url() === `${extensionOrigin}/src/popup/index.html`,
      { timeout: 10_000 },
    )
    const page = await target.asPage()
    await page.waitForSelector('#screenshot')
    return page
  }

  const waitForWorkspace = async (existing) => {
    const target = await browser.waitForTarget(
      (candidate) =>
        !existing.has(candidate) &&
        candidate.url().startsWith(`${extensionOrigin}/src/workspace/index.html`),
      { timeout: 15_000 },
    )
    const page = await target.page()
    assert(page)
    await page.waitForSelector('#choose')
    return page
  }

  const popup = await openPopup()
  const entries = await popup.$$eval('.entry strong', (elements) =>
    elements.map((element) => element.textContent),
  )
  assert.deepEqual(entries, ['截图翻译', '导入图片', '配置页'])

  const beforeImport = new Set(browser.targets())
  await popup.click('#import')
  const workspace = await waitForWorkspace(beforeImport)
  await workspace.waitForFunction(() => document.querySelector('dialog')?.open)
  const disclosure = await workspace.$eval('#privacyDialog', (dialog) => dialog.textContent)
  assert.match(disclosure, /发送到你配置的翻译服务/)
  await workspace.click('#privacyAccept')
  await workspace.waitForFunction(() => !document.querySelector('dialog')?.open)

  const input = await workspace.$('#fileInput')
  assert(input)
  await input.uploadFile(fixturePath)
  await workspace.waitForFunction(() => {
    const image = document.querySelector('#sourceImage')
    return image instanceof HTMLImageElement && image.naturalWidth > 0
  })
  assert.equal(
    await workspace.$eval('.full-selection', (selection) => selection.getAttribute('aria-label')),
    '已选择整张图片',
  )

  await workspace.keyboard.press('Enter')
  await new Promise((resolve) => setTimeout(resolve, 400))
  const translationState = await workspace.$eval('#result', (element) => ({
    text: element.textContent,
    className: element.className,
  }))
  if (translationState.text !== '第一段') {
    throw new Error(
      `first streamed chunk not visible: ${JSON.stringify({ translationState, requestCount: requests.length })}`,
    )
  }
  assert.equal(await workspace.$eval('#language', (element) => element.textContent), '英语 → 中文简体')
  await workspace.waitForFunction(
    () => document.querySelector('#result')?.textContent === '第一段第二段',
    { timeout: 10_000 },
  )
  assert.equal(await workspace.$eval('#copy', (button) => button.disabled), false)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].model, 'deterministic-image-model')
  const content = requests[0].messages.at(-1).content
  assert.equal(content[0].type, 'text')
  assert.equal(content[1].type, 'image_url')
  assert.match(content[1].image_url.url, /^data:image\/png;base64,/)

  await workspace.click('#clear')
  await workspace.waitForFunction(() => !document.querySelector('#emptyState')?.classList.contains('hidden'))

  await restrictedFixture.bringToFront()
  const fallbackPopup = await openPopup()
  const beforeFallback = new Set(browser.targets())
  await fallbackPopup.click('#screenshot')
  await new Promise((resolve) => setTimeout(resolve, 2_000))
  const fallbackStatus = fallbackPopup.isClosed()
    ? 'popup closed'
    : await fallbackPopup.$eval('#status', (element) => element.textContent)
  if (!browser.targets().some((target) => !beforeFallback.has(target))) {
    throw new Error(`restricted-page fallback did not open a tab: ${fallbackStatus}`)
  }
  const fallbackWorkspace = await waitForWorkspace(beforeFallback)
  await fallbackWorkspace.waitForFunction(() => {
    const image = document.querySelector('#sourceImage')
    return image instanceof HTMLImageElement && image.naturalWidth > 0
  })
  assert.equal(
    await fallbackWorkspace.$eval('#sourceMeta', (element) => element.textContent),
    '当前页面截图',
  )
  assert.equal(
    await fallbackWorkspace.$eval('#privacyDialog', (dialog) => dialog.open),
    false,
  )

  console.log(
    JSON.stringify({
      ok: true,
      popupEntries: entries,
      streamedText: '第一段第二段',
      restrictedPageFallback: true,
    }),
  )
} finally {
  await browser.close()
  server.close()
  fs.rmSync(tempDirectory, { recursive: true, force: true })
}
