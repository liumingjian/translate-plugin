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
let lastCaptureAt = 0
let responseMode = 'success'
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
    if (responseMode === 'unavailable') {
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'service temporarily unavailable' } }))
      return
    }
    if (responseMode === 'image-unsupported') {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'model does not support image input' } }))
      return
    }
    if (responseMode === 'auth') {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'invalid api key' } }))
      return
    }
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    response.flushHeaders()
    if (responseMode === 'network') {
      response.end()
      return
    }
    if (responseMode === 'empty') {
      response.end('data: [DONE]\n\n')
      return
    }
    if (responseMode === 'no-text') {
      response.end(
        'data: {"choices":[{"delta":{"content":"NO_TEXT"}}]}\n\ndata: [DONE]\n\n',
      )
      return
    }
    if (responseMode === 'partial') {
      response.end('data: {"choices":[{"delta":{"content":"EN>ZH\\n半段译文"}}]}\n\n')
      return
    }
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
  await browser.defaultBrowserContext().overridePermissions(baseUrl, [
    'clipboard-read',
    'clipboard-write',
  ])
  await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 1 })
  await page.goto(baseUrl, { waitUntil: 'load' })
  await page.bringToFront()
  await installPageHelpers(page)
  await new Promise((resolve) => setTimeout(resolve, 1_500))

  // Chrome 自己报告默认快捷键已注册；菜单入口随后走完整的真实截图链路。
  // CDP 键盘事件进入渲染进程时已经错过浏览器级 accelerator 分发阶段。
  await beginScreenshot(browser, worker, extensionOrigin, page)
  assert.equal(await countScreenshotModes(page), 1)
  assert.equal(await countFrameScreenshotModes(page), 0)
  assert.equal(await screenshotState(page), 'waiting-for-selection')
  assert.equal(await screenshotHandleCount(page), 8)
  const firstFrozenSource = await frozenSource(page)
  const tickBefore = await page.$eval('#ticker', (element) => element.dataset.tick)
  await new Promise((resolve) => setTimeout(resolve, 180))
  const tickAfter = await page.$eval('#ticker', (element) => element.dataset.tick)
  assert.notEqual(tickAfter, tickBefore, 'the live page should keep changing behind the frozen image')
  assert.equal(await frozenSource(page), firstFrozenSource, 'the visible capture must remain frozen')

  await drag(page, 110, 150, 270, 290)
  assert.equal(await screenshotState(page), 'adjusting-selection')
  let selection = await screenshotSelection(page)
  assert.deepEqual(selection, { left: 110, top: 150, width: 160, height: 140 })

  await drag(
    page,
    selection.left + selection.width / 2,
    selection.top + selection.height / 2,
    selection.left + selection.width / 2 + 20,
    selection.top + selection.height / 2 + 10,
  )
  selection = await screenshotSelection(page)
  assert.deepEqual(selection, { left: 130, top: 160, width: 160, height: 140 })

  for (const [handle, dx, dy] of [
    ['n', 0, -4], ['ne', 4, -4], ['e', 4, 0], ['se', 4, 4],
    ['s', 0, 4], ['sw', -4, 4], ['w', -4, 0], ['nw', -4, -4],
  ]) {
    const before = await screenshotSelection(page)
    const center = await screenshotHandleCenter(page, handle)
    await drag(page, center.x, center.y, center.x + dx, center.y + dy)
    const after = await screenshotSelection(page)
    assertHandleMoved(handle, before, after)
  }

  selection = await screenshotSelection(page)
  await drag(
    page,
    selection.left + selection.width / 2,
    selection.top + selection.height / 2,
    1_200,
    1_000,
  )
  selection = await screenshotSelection(page)
  assert(selection.left >= 0 && selection.top >= 0)
  assert(selection.left + selection.width <= 900)
  assert(selection.top + selection.height <= 700)

  await drag(
    page,
    selection.left + selection.width / 2,
    selection.top + selection.height / 2,
    660,
    220,
  )
  selection = await screenshotSelection(page)
  const confirmedRect = {
    left: selection.left,
    top: selection.top,
    right: selection.left + selection.width,
    bottom: selection.top + selection.height,
  }
  assert.equal(requests.length, 0, 'adjusting the selection must not create a request')

  await clickShadowButton(page, '确认截图')
  await page.keyboard.press('Enter')
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
  assert(
    firstStream.rect.right <= confirmedRect.left,
    'the card should flip to the left of a right-edge selection',
  )
  assertCardInViewport(firstStream.rect, { width: 900, height: 700 })
  await page.waitForFunction(() => window.__findTranslationCard()?.result === '第一段第二段')
  await page.waitForFunction(() => window.__findTranslationCard()?.copyVisible)

  await waitForRequestCount(1)
  assert.equal(requests.length, 1, 'confirming twice must still create one request')
  assert.equal(requests[0].model, 'deterministic-image-model')
  const content = requests[0].messages.at(-1).content
  assert.equal(content[0].type, 'text')
  assert.equal(content[1].type, 'image_url')
  const pixels = await decodeImage(page, content[1].image_url.url)
  assert.deepEqual(
    { width: pixels.width, height: pixels.height },
    {
      width: confirmedRect.right - confirmedRect.left,
      height: confirmedRect.bottom - confirmedRect.top,
    },
  )
  assert.deepEqual(pixels.center, [30, 80, 220, 255])

  await clickCardButton(page, '复制译文')
  await page.waitForFunction(() => window.__findTranslationCard()?.copyLabel === '已复制')
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '第一段第二段')

  // 页面外点只影响划词浮层，截图卡继续驻留。
  await page.mouse.click(20, 680)
  assert(await screenshotCard(page), 'outside clicks must not dismiss the screenshot card')

  const beforeDrag = await screenshotCard(page)
  const header = await screenshotCardHeader(page)
  await page.mouse.move(header.x, header.y)
  await page.mouse.down()
  await page.mouse.move(890, 690, { steps: 10 })
  await page.mouse.up()
  const afterDrag = await screenshotCard(page)
  assert.equal(
    afterDrag.rect.right - afterDrag.rect.left,
    beforeDrag.rect.right - beforeDrag.rect.left,
  )
  assert.equal(
    afterDrag.rect.bottom - afterDrag.rect.top,
    beforeDrag.rect.bottom - beforeDrag.rect.top,
  )
  assertCardInViewport(afterDrag.rect, { width: 900, height: 700 })
  assert.notDeepEqual(afterDrag.rect, beforeDrag.rect, 'dragging the header should move the card')

  await clickCardButton(page, '关闭截图翻译')
  await page.waitForFunction(() => !window.__findTranslationCard())

  await beginScreenshot(browser, worker, extensionOrigin, page)
  await drag(page, 120, 160, 260, 280)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !window.__findScreenshotDialog())
  await waitForRequestCount(2)
  await page.waitForFunction(() => window.__findTranslationCard()?.result === '第一段')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !window.__findTranslationCard())

  await beginScreenshot(browser, worker, extensionOrigin, page)
  await drag(page, 120, 160, 260, 280)
  await doubleClick(page, 190, 220)
  await page.waitForFunction(() => !window.__findScreenshotDialog())
  await waitForRequestCount(3)

  await beginScreenshot(browser, worker, extensionOrigin, page)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !window.__findScreenshotDialog())
  assert.equal(requests.length, 3, 'Escape must not create a request')

  await beginScreenshot(browser, worker, extensionOrigin, page)
  await clickShadowButton(page, '取消')
  await page.waitForFunction(() => !window.__findScreenshotDialog())
  assert.equal(requests.length, 3, 'the cancel button must not create a request')

  await beginScreenshot(browser, worker, extensionOrigin, page)
  await drag(page, 120, 160, 125, 165)
  assert.match(await screenshotStatus(page), /太小/)
  assert.equal(await shadowButtonDisabled(page, '确认截图'), true)
  await page.keyboard.press('Enter')
  await doubleClick(page, 122, 162)
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.equal(await countScreenshotModes(page), 1, 'an invalid selection must stay adjustable')
  assert.equal(requests.length, 3, 'an invalid selection must not create a request')
  await page.keyboard.press('Escape')

  await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 2 })
  const pageCdp = await page.target().createCDPSession()
  await pageCdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.25 })
  await beginScreenshot(browser, worker, extensionOrigin, page)
  const frozen = await frozenMetrics(page)
  await drag(page, 100.25, 150.5, 240.75, 260.25)
  const scaledSelection = await screenshotSelection(page)
  await page.keyboard.press('Enter')
  await waitForRequestCount(4)
  const scaledContent = requests[3].messages.at(-1).content
  const scaledPixels = await decodeImage(page, scaledContent[1].image_url.url)
  const expectedScaled = mappedSize(scaledSelection, frozen)
  assert.deepEqual(
    { width: scaledPixels.width, height: scaledPixels.height },
    expectedScaled,
    'page zoom and high DPR must map the confirmed display pixels to the frozen bitmap',
  )
  await pageCdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })

  for (const [mode, errorText] of [
    ['network', '请求失败'],
    ['unavailable', '翻译服务暂时不可用'],
    ['empty', '模型没有返回译文'],
  ]) {
    responseMode = mode
    const before = requests.length
    await confirmRecoveryScreenshot(browser, worker, extensionOrigin, page)
    await waitForCardError(page, errorText)
    await waitForRequestCount(before + 3)
    const failedImage = imageUrlOf(requests[before])
    const failedCard = await screenshotCard(page)
    assert(failedCard.previewVisible, `${mode} must retain the current screenshot`)
    assert(failedCard.buttons.includes('重试'), `${mode} must offer a manual retry`)

    responseMode = 'success'
    await clickCardButton(page, '重试')
    await waitForRequestCount(before + 4)
    await page.waitForFunction(() => window.__findTranslationCard()?.result === '第一段第二段')
    assert.equal(imageUrlOf(requests[before + 3]), failedImage, `${mode} retry must reuse the crop`)
  }

  responseMode = 'partial'
  let before = requests.length
  await confirmRecoveryScreenshot(browser, worker, extensionOrigin, page)
  await waitForCardError(page, '响应流意外结束')
  assert.equal(requests.length, before + 1, 'a partial stream must never replay automatically')
  let failedCard = await screenshotCard(page)
  assert.equal(failedCard.result, '半段译文')
  assert(failedCard.copyVisible, 'partial output must remain copyable')
  await clickCardButton(page, '复制译文')
  await page.waitForFunction(() => window.__findTranslationCard()?.copyLabel === '已复制')
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '半段译文')
  responseMode = 'success'
  await clickCardButton(page, '重试')
  await page.waitForFunction(() => window.__findTranslationCard()?.result === '第一段第二段')
  assert.equal(
    (await screenshotCard(page)).result,
    '第一段第二段',
    'manual retry must replace partial output instead of appending duplicate text',
  )

  responseMode = 'no-text'
  before = requests.length
  const frozenForReselect = await confirmRecoveryScreenshot(browser, worker, extensionOrigin, page)
  await waitForCardError(page, '未识别到可翻译文字')
  assert.equal(requests.length, before + 1)
  assert((await screenshotCard(page)).buttons.includes('重新框选'))
  await clickCardButton(page, '重新框选')
  await waitForScreenshotMode(page)
  assert.equal(
    await frozenSource(page),
    frozenForReselect,
    'reselect must use the original frozen capture without capturing the live page again',
  )
  responseMode = 'success'
  await drag(page, 430, 120, 610, 280)
  await page.keyboard.press('Enter')
  await waitForRequestCount(before + 2)
  await page.waitForFunction(() => window.__findTranslationCard()?.result === '第一段第二段')

  responseMode = 'image-unsupported'
  await confirmRecoveryScreenshot(browser, worker, extensionOrigin, page)
  await waitForCardError(page, '截图模型不支持图片')
  let existingTargets = new Set(browser.targets())
  await clickCardButton(page, '配置截图模型')
  let optionsTarget = await browser.waitForTarget(
    (target) => !existingTargets.has(target) && target.url().endsWith('/src/options/index.html#imageModel'),
  )
  let optionsPage = await optionsTarget.page()
  assert(optionsPage)
  await optionsPage.waitForFunction(() => document.activeElement?.id === 'imageModel')
  await optionsPage.close()

  responseMode = 'auth'
  await page.bringToFront()
  await confirmRecoveryScreenshot(browser, worker, extensionOrigin, page)
  await waitForCardError(page, '鉴权失败')
  existingTargets = new Set(browser.targets())
  await clickCardButton(page, '打开配置页')
  optionsTarget = await browser.waitForTarget(
    (target) => !existingTargets.has(target) && target.url().includes('/src/options/index.html'),
  )
  optionsPage = await optionsTarget.page()
  assert(optionsPage)
  await optionsPage.waitForSelector('#apiKey')
  await optionsPage.close()
  responseMode = 'success'
  await page.bringToFront()

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
    selectionInteractions: ['move', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'],
    confirmationPaths: ['button', 'Enter', 'double-click'],
    cancellationPaths: ['Escape', 'button'],
    confirmedPixels: [`${pixels.width}x${pixels.height}`, `${scaledPixels.width}x${scaledPixels.height}@2x`],
    streamedText: '第一段第二段',
    card: ['edge-flipped', 'viewport-constrained', 'dragged', 'persistent', 'copied', 'closed'],
    recovery: ['network', 'unavailable', 'empty', 'partial', 'no-text', 'image-model', 'auth'],
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

async function beginScreenshot(browser, worker, extensionOrigin, page) {
  const delay = 600 - (Date.now() - lastCaptureAt)
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
  await page.bringToFront()
  const popup = await openPopup(browser, worker, extensionOrigin)
  lastCaptureAt = Date.now()
  await popup.click('#screenshot')
  await waitForScreenshotMode(page)
}

async function waitForScreenshotMode(page) {
  await page.waitForFunction(() => window.__findScreenshotDialog(), { timeout: 10_000 })
}

async function confirmRecoveryScreenshot(browser, worker, extensionOrigin, page) {
  await beginScreenshot(browser, worker, extensionOrigin, page)
  const frozen = await frozenSource(page)
  await drag(page, 430, 120, 610, 280)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !window.__findScreenshotDialog())
  return frozen
}

async function waitForCardError(page, expected) {
  await page.waitForFunction(
    (text) => window.__findTranslationCard()?.error?.includes(text),
    { timeout: 15_000 },
    expected,
  )
}

function imageUrlOf(request) {
  return request.messages.at(-1).content.find((item) => item.type === 'image_url').image_url.url
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

async function frozenMetrics(page) {
  await page.waitForFunction(() => {
    const image = window.__findScreenshotDialog()
      ?.querySelector('img[alt="当前页面的冻结画面"]')
    return image?.complete && image.naturalWidth > 0
  })
  return page.evaluate(() => {
    const image = window.__findScreenshotDialog()
      .querySelector('img[alt="当前页面的冻结画面"]')
    const box = image.getBoundingClientRect()
    return {
      renderedWidth: box.width,
      renderedHeight: box.height,
      bitmapWidth: image.naturalWidth,
      bitmapHeight: image.naturalHeight,
    }
  })
}

async function screenshotState(page) {
  return page.evaluate(() => window.__findScreenshotDialog()?.dataset.state)
}

async function screenshotHandleCount(page) {
  return page.evaluate(() =>
    window.__findScreenshotDialog()?.querySelectorAll('[data-handle]').length,
  )
}

async function screenshotHandleCenter(page, handle) {
  return page.evaluate((name) => {
    const element = window.__findScreenshotDialog().querySelector(`[data-handle="${name}"]`)
    const box = element.getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  }, handle)
}

async function screenshotStatus(page) {
  return page.evaluate(() =>
    window.__findScreenshotDialog()?.querySelector('[role="status"]')?.textContent ?? '',
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

async function shadowButtonDisabled(page, label) {
  return page.evaluate((text) => {
    const button = [...window.__findScreenshotDialog().querySelectorAll('button')]
      .find((candidate) => candidate.textContent === text)
    return button.disabled
  }, label)
}

async function drag(page, fromX, fromY, toX, toY) {
  await page.mouse.move(fromX, fromY)
  await page.mouse.down()
  await page.mouse.move(toX, toY, { steps: 8 })
  await page.mouse.up()
}

async function doubleClick(page, x, y) {
  await page.mouse.move(x, y)
  await page.mouse.down({ clickCount: 1 })
  await page.mouse.up({ clickCount: 1 })
  await page.mouse.down({ clickCount: 2 })
  await page.mouse.up({ clickCount: 2 })
}

function assertHandleMoved(handle, before, after) {
  const beforeRight = before.left + before.width
  const beforeBottom = before.top + before.height
  const afterRight = after.left + after.width
  const afterBottom = after.top + after.height
  if (handle.includes('n')) assert(after.top < before.top, `${handle} must move the top edge`)
  if (handle.includes('e')) assert(afterRight > beforeRight, `${handle} must move the right edge`)
  if (handle.includes('s')) assert(afterBottom > beforeBottom, `${handle} must move the bottom edge`)
  if (handle.includes('w')) assert(after.left < before.left, `${handle} must move the left edge`)
}

function mappedSize(rect, image) {
  const left = Math.floor(rect.left / image.renderedWidth * image.bitmapWidth)
  const top = Math.floor(rect.top / image.renderedHeight * image.bitmapHeight)
  const right = Math.ceil((rect.left + rect.width) / image.renderedWidth * image.bitmapWidth)
  const bottom = Math.ceil((rect.top + rect.height) / image.renderedHeight * image.bitmapHeight)
  return { width: right - left, height: bottom - top }
}

async function waitForRequestCount(count) {
  const deadline = Date.now() + 10_000
  while (requests.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.equal(requests.length, count)
}

async function screenshotCard(page) {
  return page.evaluate(() => window.__findTranslationCard())
}

async function screenshotCardHeader(page) {
  return page.evaluate(() => {
    const card = window.__findScreenshotCard()
    const rect = card.querySelector('header').getBoundingClientRect()
    return { x: rect.left + 24, y: rect.top + rect.height / 2 }
  })
}

async function clickCardButton(page, label) {
  const position = await page.evaluate((text) => {
    const card = window.__findScreenshotCard()
    const button = [...card.querySelectorAll('button')].find((candidate) =>
      candidate.textContent === text || candidate.getAttribute('aria-label') === text,
    )
    const rect = button.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }, label)
  await page.mouse.click(position.x, position.y)
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

function assertCardInViewport(card, viewport) {
  assert(card.left >= 8)
  assert(card.top >= 8)
  assert(card.right <= viewport.width - 8 + 0.001)
  assert(card.bottom <= viewport.height - 8 + 0.001)
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
        const card = root?.querySelector('[role="dialog"][aria-label="截图翻译结果"]')
        if (!card) continue
        const rect = card.getBoundingClientRect()
        const preview = card.querySelector('img[alt="已确认的截图"]')
        const copy = [...card.querySelectorAll('button')]
          .find((button) => button.textContent === '复制译文' || button.textContent === '已复制')
        return {
          title: '截图翻译',
          badge: card.querySelector('[aria-label="翻译语言方向"]')?.textContent,
          result: card.querySelector('[role="status"]')?.textContent,
          error: card.querySelector('[role="alert"]')?.textContent,
          buttons: [...card.querySelectorAll('button')]
            .filter((button) => button.getBoundingClientRect().height > 0)
            .map((button) => button.textContent),
          copyLabel: copy?.textContent,
          copyVisible: !!copy && copy.getBoundingClientRect().height > 0,
          previewVisible: !!preview && preview.getBoundingClientRect().height > 0,
          rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        }
      }
      return null
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
