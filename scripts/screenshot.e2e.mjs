import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const CHROME =
  process.env.TP_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const requests = []
const pageHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>截图翻译测试</title>
<style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f7f7f7;font:16px sans-serif}
#red{position:fixed;left:80px;top:120px;width:300px;height:220px;background:rgb(220,30,30)}
#blue{position:fixed;left:430px;top:120px;width:300px;height:220px;background:rgb(30,80,220)}
#ticker{position:fixed;left:80px;top:40px;width:180px;height:48px;color:#fff;background:#111}
iframe{position:fixed;left:80px;top:390px;width:420px;height:120px;border:1px solid #999}
</style></head><body>
<div id="ticker">live</div><div id="red"></div><div id="blue"></div>
<iframe srcdoc="<!doctype html><p id='frameText'>Text selection inside an iframe</p>"></iframe>
<script>
let tick=0;setInterval(()=>{tick++;ticker.dataset.tick=String(tick);ticker.style.background=tick%2?'rgb(10,170,70)':'rgb(140,30,180)'},50)
</script></body></html>`

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
    requests.push(JSON.parse(body))
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    response.flushHeaders()
    response.write('data: {"choices":[{"delta":{"content":"EN>ZH\\n第一段"}}]}\n\n')
    setTimeout(() => {
      response.write('data: {"choices":[{"delta":{"content":"第二段"}}]}\n\n')
      response.end('data: [DONE]\n\n')
    }, 700)
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
  const commands = await worker.evaluate(async () => chrome.commands.getAll())
  assert(commands.some((command) =>
    command.name === 'screenshot-translate' &&
      (command.shortcut === 'Alt+Shift+S' || command.shortcut === '⌥⇧S'),
  ))

  const page = await browser.newPage()
  await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 1 })
  await page.goto(baseUrl, { waitUntil: 'load' })
  await page.bringToFront()
  await installPageHelpers(page)
  await new Promise((resolve) => setTimeout(resolve, 1_500))

  // Chrome 自己报告默认快捷键已注册；菜单入口随后走完整的真实截图链路。
  // CDP 键盘事件进入渲染进程时已经错过浏览器级 accelerator 分发阶段。
  const popup = await openPopup(browser, worker, extensionOrigin)
  await popup.click('#screenshot')
  await waitForScreenshotMode(page)
  assert.equal(await countScreenshotModes(page), 1)
  assert.equal(await countFrameScreenshotModes(page), 0)
  const firstFrozenSource = await frozenSource(page)
  const tickBefore = await page.$eval('#ticker', (element) => element.dataset.tick)
  await new Promise((resolve) => setTimeout(resolve, 180))
  const tickAfter = await page.$eval('#ticker', (element) => element.dataset.tick)
  assert.notEqual(tickAfter, tickBefore, 'the live page should keep changing behind the frozen image')
  assert.equal(await frozenSource(page), firstFrozenSource, 'the visible capture must remain frozen')

  const confirmedRect = { left: 110, top: 150, right: 270, bottom: 290 }
  await page.mouse.move(confirmedRect.left, confirmedRect.top)
  await page.mouse.down()
  await page.mouse.move(confirmedRect.right, confirmedRect.bottom, { steps: 8 })
  await page.mouse.up()
  const selection = await screenshotSelection(page)
  assert.deepEqual(selection, { left: 110, top: 150, width: 160, height: 140 })

  await clickShadowButton(page, '确认截图')
  await page.waitForFunction(() => !window.__findScreenshotDialog())
  assert.equal(await page.$eval('#red', (element) => getComputedStyle(element).backgroundColor), 'rgb(220, 30, 30)')

  await page.waitForFunction(() => {
    const card = window.__findTranslationCard()
    return card?.title === '截图翻译' && card.result === '第一段'
  })
  const firstStream = await screenshotCard(page)
  assert.equal(firstStream.badge, '英语 → 中文简体')
  assert.equal(firstStream.result, '第一段')
  assert(firstStream.previewVisible)
  assert(cardNearRect(firstStream.rect, confirmedRect), 'the card should be placed near the confirmed area')
  await page.waitForFunction(() => window.__findTranslationCard()?.result === '第一段第二段')

  assert.equal(requests.length, 1)
  assert.equal(requests[0].model, 'deterministic-image-model')
  const content = requests[0].messages.at(-1).content
  assert.equal(content[0].type, 'text')
  assert.equal(content[1].type, 'image_url')
  const pixels = await decodeImage(page, content[1].image_url.url)
  assert.deepEqual({ width: pixels.width, height: pixels.height }, { width: 160, height: 140 })
  assert.deepEqual(pixels.center, [220, 30, 30, 255])

  // 截图链路结束后，iframe 内原有的每框架划词浮层仍然工作。
  const iframe = page.frames().find((frame) => frame !== page.mainFrame())
  assert(iframe)
  await iframe.evaluate(() => {
    const element = document.getElementById('frameText')
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  await iframe.waitForFunction(() =>
    [...document.documentElement.children].some((host) => {
      const icon = host.shadowRoot?.querySelector('button[title="翻译选中文字"]')
      return icon && !icon.classList.contains('hidden')
    }),
  )

  console.log(JSON.stringify({
    ok: true,
    entries: ['menu', 'registered Alt+Shift+S'],
    frozenTopFrameOnly: true,
    restoredLivePage: true,
    confirmedPixels: `${pixels.width}x${pixels.height}`,
    streamedText: '第一段第二段',
    iframeSelectionPreserved: true,
  }))
} finally {
  await browser.close()
  server.close()
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

async function waitForScreenshotMode(page) {
  await page.waitForFunction(() => window.__findScreenshotDialog(), { timeout: 10_000 })
}

async function countScreenshotModes(page) {
  return page.evaluate(() => window.__findScreenshotDialog() ? 1 : 0)
}

async function countFrameScreenshotModes(page) {
  const counts = await Promise.all(page.frames().slice(1).map((frame) => frame.evaluate(() =>
    [...document.documentElement.children].filter((host) =>
      host.shadowRoot?.querySelector('[role="dialog"][aria-label="截图翻译框选"]'),
    ).length,
  )))
  return counts.reduce((total, count) => total + count, 0)
}

async function frozenSource(page) {
  return page.evaluate(() =>
    window.__findScreenshotDialog()?.querySelector('img[alt="当前页面的冻结画面"]')?.src,
  )
}

async function screenshotSelection(page) {
  return page.evaluate(() => {
    const selection = window.__findScreenshotDialog()?.querySelector('[aria-label="框选区域"]')
    const rect = selection.getBoundingClientRect()
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  })
}

async function clickShadowButton(page, label) {
  const rect = await page.evaluate((text) => {
    const button = [...window.__findScreenshotDialog().querySelectorAll('button')]
      .find((candidate) => candidate.textContent === text)
    const box = button.getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  }, label)
  await page.mouse.click(rect.x, rect.y)
}

async function screenshotCard(page) {
  return page.evaluate(() => window.__findTranslationCard())
}

function cardNearRect(card, anchor) {
  const horizontalGap = Math.min(
    Math.abs(card.left - anchor.right),
    Math.abs(card.right - anchor.left),
  )
  const verticalGap = Math.min(
    Math.abs(card.top - anchor.bottom),
    Math.abs(card.bottom - anchor.top),
  )
  return horizontalGap <= 16 || verticalGap <= 16
}

async function decodeImage(page, dataUrl) {
  return page.evaluate(async (source) => {
    const image = new Image()
    image.src = source
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    return {
      width: canvas.width,
      height: canvas.height,
      center: Array.from(context.getImageData(
        Math.floor(canvas.width / 2),
        Math.floor(canvas.height / 2),
        1,
        1,
      ).data),
    }
  }, dataUrl)
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
      for (const host of document.documentElement.children) {
        const root = host.shadowRoot
        const title = [...(root?.querySelectorAll('.header span') ?? [])]
          .find((element) => element.textContent === '截图翻译')
        if (!title) continue
        const card = title.closest('.card')
        if (!card || card.classList.contains('hidden')) continue
        const rect = card.getBoundingClientRect()
        const preview = card.querySelector('img[alt="已确认的截图"]')
        return {
          title: title.textContent,
          badge: card.querySelector('.badge')?.textContent,
          result: card.querySelector('.result')?.textContent,
          previewVisible: !!preview && preview.getBoundingClientRect().height > 0,
          rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        }
      }
      return null
    }
  })
}
