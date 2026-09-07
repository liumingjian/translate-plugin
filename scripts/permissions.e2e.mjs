// 生产构建的权限验收。
//
// e2e 构建在 manifest 里额外声明 <all_urls>，所以其余 e2e 全部绕开了生产真正依赖的
// activeTab 授权。这个脚本只跑生产构建，守住两件事：
//   1. 发布产物不得夹带测试用的宽泛主机权限；
//   2. 截图捕获失败时必须让用户看见原因，不能点完毫无反应。
//
// 它不假装能验证 activeTab 本身：Chrome 只在用户真实点击工具栏图标时授予，而
// chrome.action.openPopup() 不会（见 manifest.config.ts 的注释），puppeteer 也点不到
// 浏览器 chrome。所以这里断言的是「静默失败不可接受」，而不是「捕获一定成功」。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { DIST, launchExtension, listen, safeError, safeLog } from './e2e/harness.mjs'

const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8'))
const hostPermissions = manifest.host_permissions ?? []

let browser
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end('<!doctype html><meta charset="utf-8"><p id="target">permissions fixture</p>')
})

try {
  assert(
    manifest.permissions?.includes('activeTab'),
    'production manifest must declare activeTab',
  )
  assert(
    !hostPermissions.includes('<all_urls>'),
    'production manifest must not ship the e2e <all_urls> permission',
  )
  assert(
    !hostPermissions.some((pattern) => pattern.includes('127.0.0.1')),
    'production manifest must not ship the e2e localhost permission',
  )

  const origin = await listen(server)
  const extension = await launchExtension()
  browser = extension.browser
  const page = await browser.newPage()
  await page.goto(origin, { waitUntil: 'load' })
  await page.bringToFront()

  const existing = new Set(browser.targets())
  await extension.worker.evaluate(async () => chrome.action.openPopup())
  const popupTarget = await browser.waitForTarget(
    (candidate) =>
      !existing.has(candidate) &&
      candidate.url() === `${extension.extensionOrigin}/src/popup/index.html`,
    { timeout: 10_000 },
  )
  const popup = await popupTarget.asPage()
  await popup.waitForSelector('#screenshot')
  await popup.click('#screenshot')

  const outcome = await waitForOutcome(page, popup)
  assert(
    outcome.kind !== 'silent',
    'clicking 截图翻译 must either enter screenshot mode or surface an error, never do nothing',
  )

  safeLog({
    ok: true,
    mode: 'permissions',
    hostPermissions,
    outcome: outcome.kind,
    ...(outcome.kind === 'error' ? { errorSurfaced: true, status: outcome.status } : {}),
  })
} catch (error) {
  safeLog({ ok: false, mode: 'permissions', error: safeError(error) })
  process.exitCode = 1
} finally {
  await browser?.close()
  server.close()
}

// 两种可接受的结局：冻结画面出现，或弹窗里出现非空错误文案。
async function waitForOutcome(page, popup, timeout = 10_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await screenshotModeVisible(page)) return { kind: 'screenshot-mode' }
    if (popup.isClosed()) break
    const status = await popup
      .evaluate(() => document.getElementById('status')?.textContent?.trim() ?? '')
      .catch(() => '')
    if (status) return { kind: 'error', status }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return { kind: (await screenshotModeVisible(page)) ? 'screenshot-mode' : 'silent' }
}

function screenshotModeVisible(page) {
  return page
    .evaluate(() =>
      [...document.documentElement.children].some((element) =>
        element.shadowRoot?.querySelector('[data-state]'),
      ),
    )
    .catch(() => false)
}
