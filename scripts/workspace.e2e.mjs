import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {
  assertHandleCenters,
  assertScale095,
  closeServer,
  drag,
  isMinimumTarget,
  launchBrowser,
  listen,
  loadExtension,
  pressShiftArrow,
  respondToBrowserPermissionPrompt,
  waitForCount,
} from './e2e/harness.mjs'
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'translate-plugin-workspace-'))
const fixturePath = path.join(tempDirectory, 'crop-image.png')

const requests = []
let responseMode = 'success'
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
    if (responseMode === 'image-unsupported') {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'model does not support image input' } }))
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
    if (responseMode === 'no-text') {
      response.end(
        'data: {"choices":[{"delta":{"content":"NO_TEXT"}}]}\n\ndata: [DONE]\n\n',
      )
      return
    }
    if (responseMode === 'partial') {
      response.end('data: {"choices":[{"delta":{"content":"EN>ZH\\n工作区半段"}}]}\n\n')
      return
    }
    response.write(
      'data: {"choices":[{"delta":{"content":"EN>ZH\\n第一段"}}]}\n\n',
    )
    setTimeout(() => {
      response.write('data: {"choices":[{"delta":{"content":"第二段"}}]}\n\n')
      response.end('data: [DONE]\n\n')
    }, 1_500)
  })
})

const baseUrl = await listen(server)

const browser = await launchBrowser({ userDataDir: process.env.TP_E2E_CLIPBOARD_PROFILE })

try {
  // 扩展安装前已打开的页面没有 content script，稳定复现顶层框架无法承载截图 UI。
  // headless 的 chrome.action.openPopup() 不会授予 activeTab，因此测试构建临时使用
  // <all_urls> 完成真实 captureVisibleTab；本地服务另有 localhost 权限。生产构建均不含。
  const restrictedFixture = await browser.newPage()
  await restrictedFixture.goto(baseUrl, { waitUntil: 'load' })
  const fixtureDataUrl = await restrictedFixture.evaluate(() => {
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

  const { extensionOrigin, worker } = await loadExtension(browser)
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
  const popupTree = await popup.accessibility.snapshot()
  assert.deepEqual(
    collectAccessibleButtons(popupTree),
    ['截图翻译 Alt+Shift+S', '导入图片 打开图片翻译工作区', '配置页 翻译服务与模型'],
  )
  const popupDesign = await surfaceDesign(popup, 'main', '#screenshot')
  assert.equal(popupDesign.shadow, 'none')
  assert.equal(popupDesign.primaryBackground, 'rgb(0, 102, 204)')
  assert(popupDesign.buttonSizes.every(isMinimumTarget), 'popup entries must be 44px targets')
  assertScale095(await pressedTransform(popup, '#import', false), 'popup entry')
  await popup.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
  assert((await contrastFor(popup, 'body')) >= 4.5, 'dark popup text must keep readable contrast')
  await popup.focus('#screenshot')
  assert.equal(await popup.evaluate(() => document.activeElement?.id), 'screenshot')
  await popup.keyboard.press('Tab')
  assert.equal(await popup.evaluate(() => document.activeElement?.id), 'import')

  const beforeImport = new Set(browser.targets())
  await popup.keyboard.press('Enter')
  const workspace = await waitForWorkspace(beforeImport)
  await workspace.setViewport({ width: 360, height: 640, deviceScaleFactor: 2 })
  await workspace.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
  await workspace.waitForFunction(() => document.querySelector('dialog')?.open)
  assert.equal(await hasHorizontalOverflow(workspace), false)
  assert((await contrastFor(workspace, 'body')) >= 4.5, 'dark workspace text must keep readable contrast')
  const disclosure = await workspace.$eval('#privacyDialog', (dialog) => dialog.textContent)
  assert.match(disclosure, /发送到你配置的翻译服务/)
  const dialogDesign = await surfaceDesign(workspace, '#privacyDialog', '#privacyAccept')
  assert.equal(dialogDesign.shadow, 'none')
  assert.equal(dialogDesign.primaryBackground, 'rgb(0, 102, 204)')
  assert(dialogDesign.buttonSizes.every(isMinimumTarget), 'privacy dialog buttons must be 44px targets')
  assertScale095(await pressedTransform(workspace, '#privacyAccept'), 'workspace privacy button')
  await workspace.waitForFunction(() => !document.querySelector('dialog')?.open)
  assert.equal(await workspace.$eval('.empty-state', (element) => getComputedStyle(element).boxShadow), 'none')

  const input = await workspace.$('#fileInput')
  assert(input)
  await input.uploadFile(fixturePath)
  await workspace.waitForFunction(() => {
    const image = document.querySelector('#sourceImage')
    return image instanceof HTMLImageElement && image.naturalWidth > 0
  })
  await workspace.waitForFunction(() => document.activeElement?.id === 'cropSelection')
  assert.equal(
    await workspace.$eval('.full-selection', (selection) => selection.getAttribute('aria-label')),
    '已选择整张图片',
  )
  assert.equal(await workspace.$$eval('.crop-handle', (handles) => handles.length), 8)
  assert.equal(await workspace.evaluate(() => document.activeElement?.id), 'cropSelection')
  const workspaceDesign = await surfaceDesign(workspace, 'body', '#translate')
  assert.equal(workspaceDesign.primaryBackground, 'rgb(0, 102, 204)')
  assert(workspaceDesign.buttonSizes.every(isMinimumTarget), 'workspace buttons must be 44px targets')
  const cropHandleDesign = await workspaceCropHandleDesign(workspace)
  assert(cropHandleDesign.sizes.every(isMinimumTarget), 'workspace crop handles must be 44px targets')
  assertHandleCenters(cropHandleDesign.selection, cropHandleDesign.centers)
  const initialKeyboardSelection = await elementBox(workspace, '#cropSelection')
  await workspace.keyboard.press('Tab')
  assert.equal(
    await workspace.evaluate(() => document.activeElement?.getAttribute('aria-label')),
    '调整上边界',
  )
  await pressShiftArrow(workspace, 'ArrowDown')
  assert.equal((await elementBox(workspace, '#cropSelection')).top, initialKeyboardSelection.top + 10)
  await pressShiftArrow(workspace, 'ArrowUp')
  assert.equal((await elementBox(workspace, '#cropSelection')).top, initialKeyboardSelection.top)
  assert.equal(requests.length, 0, 'keyboard crop adjustment must not submit a request')
  assert.equal(await hasHorizontalOverflow(workspace), false)
  await workspace.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  await workspace.setViewport({ width: 900, height: 700, deviceScaleFactor: 1 })

  await workspace.click('#newSelection')
  const frame = await workspace.$eval('.image-frame', (element) => {
    const box = element.getBoundingClientRect()
    return { left: box.left, top: box.top, width: box.width, height: box.height }
  })
  await drag(
    workspace,
    frame.left + frame.width * 0.05,
    frame.top + frame.height * 0.1,
    frame.left + frame.width * 0.4,
    frame.top + frame.height * 0.9,
  )
  let selection = await elementBox(workspace, '#cropSelection')
  await drag(
    workspace,
    selection.left + selection.width / 2,
    selection.top + selection.height / 2,
    selection.left + selection.width / 2 + frame.width * 0.05,
    selection.top + selection.height / 2,
  )
  const eastHandle = await elementBox(workspace, '.crop-handle-e')
  await drag(
    workspace,
    eastHandle.left + eastHandle.width / 2,
    eastHandle.top + eastHandle.height / 2,
    eastHandle.left + eastHandle.width / 2 - frame.width * 0.05,
    eastHandle.top + eastHandle.height / 2,
  )
  selection = await elementBox(workspace, '#cropSelection')
  assert(selection.left >= frame.left - 1)
  assert(selection.top >= frame.top - 1)
  assert(selection.left + selection.width <= frame.left + frame.width + 1)
  assert(selection.top + selection.height <= frame.top + frame.height + 1)
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.equal(requests.length, 0, 'editing the crop must not submit a request')

  assertScale095(await pressedTransform(workspace, '#translate'), 'workspace primary button')
  await workspace.waitForFunction(
    () => document.querySelector('#result')?.textContent === '第一段',
    { timeout: 3_000 },
  )
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
  const expectedCrop = {
    x: Math.floor((selection.left - frame.left) / frame.width * 400),
    y: Math.floor((selection.top - frame.top) / frame.height * 200),
    right: Math.ceil((selection.left + selection.width - frame.left) / frame.width * 400),
    bottom: Math.ceil((selection.top + selection.height - frame.top) / frame.height * 200),
  }
  const encodedCrop = await workspace.evaluate(async (dataUrl) => {
    const image = new Image()
    image.src = dataUrl
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
  }, content[1].image_url.url)
  assert.deepEqual(
    { width: encodedCrop.width, height: encodedCrop.height },
    {
      width: expectedCrop.right - expectedCrop.x,
      height: expectedCrop.bottom - expectedCrop.y,
    },
  )
  assert.deepEqual(encodedCrop.center, [220, 30, 30, 255])

  await workspace.waitForFunction(
    () => document.querySelector('#translate')?.disabled === false,
    { timeout: 10_000 },
  )
  selection = await elementBox(workspace, '#cropSelection')
  await workspace.mouse.click(
    selection.left + selection.width / 2,
    selection.top + selection.height / 2,
    { count: 2, delay: 60 },
  )
  await waitForRequestCount(2)
  await workspace.waitForFunction(
    () => document.querySelector('#translate')?.disabled === false,
    { timeout: 10_000 },
  )
  await workspace.keyboard.press('Enter')
  await waitForRequestCount(3)
  await workspace.waitForFunction(
    () => document.querySelector('#translate')?.disabled === false,
    { timeout: 10_000 },
  )

  const retainedSource = await workspace.$eval('#sourceImage', (image) => image.src)
  responseMode = 'network'
  let beforeRecovery = requests.length
  await workspace.click('#translate')
  await workspace.waitForFunction(
    () => document.querySelector('#resultError')?.textContent?.includes('请求失败'),
    { timeout: 15_000 },
  )
  await waitForRequestCount(beforeRecovery + 3)
  assert.equal(await workspace.$eval('#sourceImage', (image) => image.src), retainedSource)
  assert.equal(await workspace.$eval('#translate', (button) => button.textContent), '重试翻译')
  const failedImage = imageUrlOf(requests[beforeRecovery])
  responseMode = 'success'
  await workspace.click('#translate')
  await waitForRequestCount(beforeRecovery + 4)
  await workspace.waitForFunction(
    () => document.querySelector('#result')?.textContent === '第一段第二段',
  )
  assert(
    imageUrlOf(requests[beforeRecovery + 3]) === failedImage,
    'workspace retry must reuse the crop',
  )

  responseMode = 'partial'
  beforeRecovery = requests.length
  await workspace.click('#translate')
  await workspace.waitForFunction(
    () => document.querySelector('#resultError')?.textContent?.includes('响应流意外结束'),
  )
  assert.equal(requests.length, beforeRecovery + 1, 'partial workspace output must not auto-replay')
  assert.equal(await workspace.$eval('#result', (element) => element.textContent), '工作区半段')
  assert.equal(await workspace.$eval('#copy', (button) => button.disabled), false)
  await workspace.click('#copy')
  await workspace.waitForFunction(() => document.querySelector('#copy')?.textContent === '已复制')
  responseMode = 'success'
  await workspace.click('#translate')
  await workspace.waitForFunction(
    () => document.querySelector('#result')?.textContent === '第一段第二段',
  )
  assert.equal(
    await workspace.$eval('#result', (element) => element.textContent),
    '第一段第二段',
    'workspace retry must replace partial output',
  )

  responseMode = 'image-unsupported'
  await workspace.click('#translate')
  await workspace.waitForFunction(
    () => document.querySelector('#resultError')?.textContent?.includes('截图模型配置'),
  )
  const beforeOptions = new Set(browser.targets())
  await workspace.click('#openOptions')
  const optionsTarget = await browser.waitForTarget(
    (target) => !beforeOptions.has(target) && target.url().endsWith('/src/options/index.html#imageModel'),
  )
  const optionsPage = await optionsTarget.page()
  assert(optionsPage)
  await optionsPage.waitForFunction(() => document.activeElement?.id === 'imageModel')
  await optionsPage.setViewport({ width: 360, height: 640, deviceScaleFactor: 2 })
  assert.equal(await hasHorizontalOverflow(optionsPage), false)
  const optionsDesign = await surfaceDesign(optionsPage, 'main', '#save')
  assert.equal(optionsDesign.shadow, 'none')
  assert.equal(optionsDesign.primaryBackground, 'rgb(0, 102, 204)')
  assert(optionsDesign.buttonSizes.every(isMinimumTarget), 'options buttons must be 44px targets')
  const optionsControlSizes = await optionsPage.$$eval('input, select', (controls) => controls
    .filter((control) => control.getBoundingClientRect().height > 0)
    .map((control) => {
      const box = control.getBoundingClientRect()
      return { width: box.width, height: box.height }
    }))
  assert(optionsControlSizes.every(isMinimumTarget), 'options controls must be 44px targets')
  assertScale095(await pressedTransform(optionsPage, '#shortcuts', false), 'options button')
  await optionsPage.close()
  await workspace.bringToFront()

  responseMode = 'no-text'
  await workspace.click('#translate')
  await workspace.waitForFunction(
    () =>
      document.querySelector('#resultError')?.textContent?.includes('未识别到可翻译文字') &&
      document.querySelector('#imageStatus')?.textContent?.includes('重新框选'),
  )
  assert.equal(await workspace.$eval('#sourceImage', (image) => image.src), retainedSource)
  assert.equal(await workspace.$eval('#translate', (button) => button.disabled), true)

  const fileChooser = workspace.waitForFileChooser()
  await workspace.click('#reimport')
  await (await fileChooser).accept([fixturePath])
  await workspace.waitForFunction(
    () =>
      document.querySelector('#sourceMeta')?.textContent === 'crop-image.png' &&
      document.querySelector('#result')?.textContent?.includes('已选择整张图片'),
  )
  responseMode = 'success'

  await workspace.click('#clear')
  await workspace.waitForFunction(() => !document.querySelector('#emptyState')?.classList.contains('hidden'))

  const hasClipboardReadPermission = () =>
    worker.evaluate(() => chrome.permissions.contains({ permissions: ['clipboardRead'] }))

  const writeClipboardImage = async () => {
    await workspace.bringToFront()
    await workspace.evaluate(async (dataUrl) => {
      const blob = await (await fetch(dataUrl)).blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    }, `data:image/png;base64,${PNG.toString('base64')}`)
  }

  const dropImage = async (name) => {
    await workspace.evaluate(
      (dataUrl, fileName) => {
        const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (value) => value.charCodeAt(0))
        const transfer = new DataTransfer()
        transfer.items.add(new File([bytes], fileName, { type: 'image/png' }))
        document.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: transfer }))
        document.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }))
      },
      `data:image/png;base64,${PNG.toString('base64')}`,
      name,
    )
  }

  const pasteClipboardImage = async (focusSelector) => {
    await writeClipboardImage()
    await workspace.click(focusSelector)
    const session = await workspace.createCDPSession()
    await session.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'v',
      code: 'KeyV',
      windowsVirtualKeyCode: 86,
      commands: ['Paste'],
    })
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'v',
      code: 'KeyV',
      windowsVirtualKeyCode: 86,
    })
  }

  const initialClipboardPermission = await hasClipboardReadPermission()
  if (!process.env.TP_E2E_CLIPBOARD_PROFILE) assert.equal(initialClipboardPermission, false)
  await dropImage('dragged-image.png')
  await workspace.waitForFunction(
    () => document.querySelector('#sourceMeta')?.textContent === 'dragged-image.png',
  )
  assert.equal(await hasClipboardReadPermission(), initialClipboardPermission)

  await workspace.click('#clear')
  await pasteClipboardImage('#emptyState')
  await workspace.waitForFunction(
    () => document.querySelector('#sourceMeta')?.textContent === '系统剪贴板图片',
  )
  assert.equal(await hasClipboardReadPermission(), initialClipboardPermission)

  await browser.defaultBrowserContext().overridePermissions(extensionOrigin, [
    'clipboard-read',
    'clipboard-write',
  ])
  let permissionBoundary
  if (initialClipboardPermission) {
    await workspace.click('#clear')
    await writeClipboardImage()
    await workspace.click('#autoReadClipboard')
    await workspace.waitForFunction(
      () => document.querySelector('#autoReadClipboard')?.checked === true,
      { timeout: 10_000 },
    )
    permissionBoundary = { grant: 'Chrome optional permission from controlled profile' }
  } else if (process.env.TP_E2E_MANUAL_PERMISSIONS === '1') {
    await workspace.click('#clear')
    await writeClipboardImage()
    await workspace.click('#autoReadClipboard')
    await waitForClipboardPermissionDecision(worker, workspace, 120_000)
    permissionBoundary = { grantAttempt: 'Chrome optional permission prompt answered manually' }
  } else if (process.env.TP_E2E_OS_PERMISSIONS === '1') {
    const permissionAction = process.env.TP_E2E_OS_PERMISSION_ACTION ?? 'deny'
    await workspace.click('#autoReadClipboard')
    await new Promise((resolve) => setTimeout(resolve, 500))
    const osResponse = await respondToBrowserPermissionPrompt(
      permissionAction,
      '图片翻译工作区',
      browser.process()?.pid,
    )
    await waitForClipboardPermissionDecision(worker, workspace)
    permissionBoundary = permissionAction === 'deny'
      ? { deny: 'Chrome optional permission prompt dismissed by OS Escape' }
      : { grantAttempt: osResponse.reason }
  } else {
    permissionBoundary = {
      request: 'not exercised: requires headed Chrome browser UI; CDP cannot inspect the prompt',
    }
  }
  const permissionGranted = await hasClipboardReadPermission()

  if (permissionGranted) {
    await workspace.waitForFunction(
      () => document.querySelector('#sourceMeta')?.textContent === '系统剪贴板图片',
      { timeout: 10_000 },
    )
    await workspace.click('#clear')
    await writeClipboardImage()
    await workspace.reload({ waitUntil: 'load' })
    await workspace.waitForFunction(
      () =>
        document.querySelector('#autoReadClipboard')?.checked === true &&
        document.querySelector('#sourceMeta')?.textContent === '系统剪贴板图片',
      { timeout: 10_000 },
    )

    await workspace.evaluate(() => navigator.clipboard.writeText('clipboard contains text only'))
    await workspace.reload({ waitUntil: 'load' })
    await workspace.waitForFunction(
      () => !document.querySelector('#emptyState')?.classList.contains('hidden'),
    )
    assert.equal(await workspace.$eval('#imageStatus', (element) => element.textContent), '')

    await workspace.click('#autoReadClipboard')
    await workspace.waitForFunction(
      () => document.querySelector('#autoReadClipboard')?.checked === false,
    )
    await waitForClipboardPermission(worker, false)
    assert.match(
      await workspace.$eval('#imageStatus', (element) => element.textContent),
      /自动读取已关闭/,
    )
  } else if (process.env.TP_E2E_OS_PERMISSIONS === '1') {
    assert.match(
      await workspace.$eval('#imageStatus', (element) => element.textContent),
      /未授予剪贴板读取权限/,
    )
  }

  await dropImage('after-revocation.png')
  await workspace.waitForFunction(
    () => document.querySelector('#sourceMeta')?.textContent === 'after-revocation.png',
  )
  await pasteClipboardImage('#imageStage')
  await workspace.waitForFunction(
    () => document.querySelector('#sourceMeta')?.textContent === '系统剪贴板图片',
  )

  const afterRevocationInput = await workspace.$('#fileInput')
  assert(afterRevocationInput)
  await afterRevocationInput.uploadFile(fixturePath)
  await workspace.waitForFunction(
    () => document.querySelector('#sourceMeta')?.textContent === 'crop-image.png',
  )

  const restrictedPageFallback = !permissionGranted
  if (restrictedPageFallback) {
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
  }

  console.log(
    JSON.stringify({
      ok: true,
      popupEntries: entries,
      streamedText: '第一段第二段',
      recovery: ['network', 'partial', 'no-text', 'image-model', 'retry', 'copy', 'reimport', 'clear'],
      cropPixels: `${encodedCrop.width}x${encodedCrop.height}`,
      explicitSubmitMethods: ['button', 'double-click', 'Enter'],
      keyboardCrop: ['focus', 'nudge', 'resize'],
      imageImports: permissionGranted
        ? ['file', 'drop', 'manual-paste', 'auto-read']
        : ['file', 'drop', 'manual-paste'],
      clipboardPermission: permissionGranted
        ? { ...permissionBoundary, revoke: 'Chrome optional permission', noImage: true }
        : {
            ...permissionBoundary,
            grant: 'requires TP_E2E_MANUAL_PERMISSIONS or a pre-authorized profile',
          },
      restrictedPageFallback,
      accessibility: ['popup-names', 'dark', 'high-dpr', 'narrow-viewport'],
    }),
  )
} finally {
  await browser.close()
  await closeServer(server)
  fs.rmSync(tempDirectory, { recursive: true, force: true })
}

async function elementBox(page, selector) {
  return page.$eval(selector, (element) => {
    const box = element.getBoundingClientRect()
    return { left: box.left, top: box.top, width: box.width, height: box.height }
  })
}

async function surfaceDesign(page, surfaceSelector, primarySelector) {
  return page.evaluate((surface, primary) => {
    const element = document.querySelector(surface)
    const primaryButton = document.querySelector(primary)
    return {
      shadow: getComputedStyle(element).boxShadow,
      primaryBackground: getComputedStyle(primaryButton).backgroundColor,
      buttonSizes: [...element.querySelectorAll('button')]
        .filter((button) => button.getBoundingClientRect().height > 0)
        .map((button) => {
          const box = button.getBoundingClientRect()
          return { width: box.width, height: box.height }
        }),
    }
  }, surfaceSelector, primarySelector)
}

async function pressedTransform(page, selector, releaseOnTarget = true) {
  const box = await elementBox(page, selector)
  const x = box.left + box.width / 2
  const y = box.top + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  const transform = await page.$eval(selector, (button) => getComputedStyle(button).transform)
  if (!releaseOnTarget) await page.mouse.move(1, 1)
  await page.mouse.up()
  return transform
}

async function workspaceCropHandleDesign(page) {
  return page.evaluate(() => {
    const selection = document.querySelector('#cropSelection').getBoundingClientRect()
    const handles = [...document.querySelectorAll('.crop-handle')]
    return {
      selection: {
        left: selection.left,
        top: selection.top,
        right: selection.right,
        bottom: selection.bottom,
      },
      sizes: handles.map((handle) => {
        const box = handle.getBoundingClientRect()
        return { width: box.width, height: box.height }
      }),
      centers: Object.fromEntries(handles.map((handle) => {
        const box = handle.getBoundingClientRect()
        return [handle.dataset.handle, {
          x: box.left + box.width / 2,
          y: box.top + box.height / 2,
        }]
      })),
    }
  })
}

async function waitForRequestCount(count) {
  await waitForCount(requests, count)
}

async function waitForClipboardPermission(worker, expected) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const actual = await worker.evaluate(() =>
      chrome.permissions.contains({ permissions: ['clipboardRead'] }),
    )
    if (actual === expected) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`clipboardRead permission did not become ${expected}`)
}

async function waitForClipboardPermissionDecision(worker, workspace, timeout = 15_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const granted = await worker.evaluate(() =>
      chrome.permissions.contains({ permissions: ['clipboardRead'] }),
    )
    const denied = await workspace.$eval('#imageStatus', (element) =>
      element.textContent?.includes('未授予剪贴板读取权限') ?? false,
    )
    if (granted || denied) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Chrome optional permission prompt did not settle after the OS response')
}

function imageUrlOf(request) {
  return request.messages.at(-1).content.find((item) => item.type === 'image_url').image_url.url
}

function collectAccessibleButtons(node) {
  if (!node) return []
  const own = node.role === 'button' ? [node.name] : []
  return own.concat(...(node.children ?? []).map(collectAccessibleButtons))
}

async function hasHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
}

async function contrastFor(page, selector) {
  return page.$eval(selector, (element) => {
    const style = getComputedStyle(element)
    const rgb = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number)
    const luminance = (value) => {
      const channels = rgb(value).map((channel) => {
        const normalized = channel / 255
        return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4
      })
      return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2]
    }
    const foreground = luminance(style.color)
    const background = luminance(style.backgroundColor)
    return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05)
  })
}
