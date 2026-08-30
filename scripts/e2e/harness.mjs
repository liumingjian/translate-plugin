import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const DIST = path.join(ROOT, 'dist')
export const FIXTURES = path.join(ROOT, 'tests', 'fixtures')
export const CHROME =
  process.env.TP_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const execFileAsync = promisify(execFile)

export function loadRealServiceEnv() {
  const envFile = process.env.TP_ENV_FILE ?? path.join(path.dirname(ROOT), 'translate-plugin', '.env.local')
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile)
  return {
    baseUrl: process.env.TP_BASE_URL || process.env.OPENAI_BASE_URL || '',
    apiKey: process.env.TP_API_KEY || process.env.OPENAI_API_KEY || '',
  }
}

export async function launchBrowser(options = {}) {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: process.env.TP_HEADLESS === '0' ? false : true,
    pipe: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    userDataDir: options.userDataDir ?? process.env.TP_E2E_BROWSER_PROFILE,
    args: [
      '--enable-unsafe-extension-debugging',
      '--no-first-run',
      '--no-default-browser-check',
      ...(options.args ?? []),
    ],
  })
}

export async function loadExtension(browser) {
  const cdp = await browser.target().createCDPSession()
  const { id: extensionId } = await cdp.send('Extensions.loadUnpacked', { path: DIST })
  const extensionOrigin = `chrome-extension://${extensionId}`
  const target = await browser.waitForTarget(
    (candidate) =>
      candidate.type() === 'service_worker' && candidate.url().startsWith(extensionOrigin),
    { timeout: 20_000 },
  )
  const worker = await target.worker()
  if (!worker) throw new Error('extension service worker did not start')
  return { extensionOrigin, extensionId, worker }
}

export async function launchExtension(options) {
  const browser = await launchBrowser(options)
  return { browser, ...(await loadExtension(browser)) }
}

export async function setSettings(worker, settings) {
  await worker.evaluate(async (value) => {
    if (value === null) await chrome.storage.local.clear()
    else await chrome.storage.local.set({ settings: value })
  }, settings)
}

export async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  return `http://127.0.0.1:${server.address().port}`
}

export async function closeServer(server) {
  if (!server?.listening) return
  server.closeAllConnections?.()
  await new Promise((resolve) => server.close(resolve))
}

export async function drag(page, fromX, fromY, toX, toY, steps = 6) {
  await page.mouse.move(fromX, fromY)
  await page.mouse.down()
  await page.mouse.move(toX, toY, { steps })
  await page.mouse.up()
}

export async function pressShiftArrow(page, key) {
  await page.keyboard.down('Shift')
  await page.keyboard.press(key)
  await page.keyboard.up('Shift')
}

export async function waitForCount(items, count, timeout = 5_000) {
  const deadline = Date.now() + timeout
  while (items.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  if (items.length !== count) {
    throw new Error(`expected ${count} records, received ${items.length}`)
  }
}

/**
 * CDP key events start in a renderer and cannot exercise Chrome's command accelerator.
 * This opt-in macOS path sends the key chord at the OS level. It requires a headed run
 * and Accessibility permission for the process running pnpm.
 */
export async function triggerBrowserShortcut(processId) {
  if (process.env.TP_E2E_OS_SHORTCUT !== '1') {
    return { executed: false, reason: 'set TP_E2E_OS_SHORTCUT=1 for the macOS platform harness' }
  }
  if (process.platform !== 'darwin' || process.env.TP_HEADLESS !== '0') {
    throw new Error('TP_E2E_OS_SHORTCUT requires macOS and TP_HEADLESS=0')
  }
  if (!process.env.TP_E2E_QUARTZ_HELPER || !processId) {
    throw new Error('TP_E2E_OS_SHORTCUT requires TP_E2E_QUARTZ_HELPER and a Chrome process id')
  }
  await execFileAsync(process.env.TP_E2E_QUARTZ_HELPER, [String(processId)])
  return { executed: true, reason: null }
}

export async function respondToBrowserPermissionPrompt(
  action,
  windowTitle = '图片翻译工作区',
  processId,
) {
  if (process.env.TP_E2E_OS_PERMISSIONS !== '1') {
    return { executed: false, reason: 'set TP_E2E_OS_PERMISSIONS=1 for the macOS platform harness' }
  }
  if (process.platform !== 'darwin' || process.env.TP_HEADLESS !== '0') {
    throw new Error('TP_E2E_OS_PERMISSIONS requires macOS and TP_HEADLESS=0')
  }
  if (action === 'ax-accept') {
    if (!process.env.TP_E2E_AX_PERMISSION_HELPER || !processId) {
      throw new Error('ax-accept requires TP_E2E_AX_PERMISSION_HELPER and a Chrome process id')
    }
    const args = [String(processId)]
    if (process.env.TP_E2E_AX_ACCEPT_LABEL) args.push(process.env.TP_E2E_AX_ACCEPT_LABEL)
    const { stdout } = await execFileAsync(process.env.TP_E2E_AX_PERMISSION_HELPER, args)
    return { executed: true, reason: stdout.trim() }
  }
  const application = process.env.TP_CHROME_APP ?? 'Google Chrome'
  const focusWindow = [
    '-e', `tell application ${JSON.stringify(application)}`,
    '-e', 'activate',
    '-e', `set targetWindow to first window whose name contains ${JSON.stringify(windowTitle)}`,
    '-e', 'set index of targetWindow to 1',
    '-e', 'end tell',
    '-e', 'delay 0.3',
  ]
  const tabCount = Number.parseInt(process.env.TP_E2E_OS_PERMISSION_TABS ?? '1', 10)
  const acceptKeys = Array.from({ length: Math.max(0, tabCount) }, () => [
    '-e', 'tell application "System Events" to key code 48',
    '-e', 'delay 0.2',
  ]).flat()
  acceptKeys.push('-e', 'tell application "System Events" to key code 36')
  const keystrokes = action === 'accept'
    ? acceptKeys
    : ['-e', 'tell application "System Events" to key code 53']
  await execFileAsync('/usr/bin/osascript', [...focusWindow, ...keystrokes])
  return { executed: true, reason: null }
}

export function createFixtureServer({ pageHtml, onChat }) {
  return http.createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(pageHtml)
      return
    }
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => onChat(JSON.parse(body), response))
  })
}

export function sendSse(response, content) {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'close',
  })
  response.end(
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
  )
}

export function safeLog(record) {
  console.log(JSON.stringify(record))
}

export function safeError(error, secrets = []) {
  let message = error instanceof Error ? error.message : String(error)
  for (const secret of secrets.filter(Boolean)) message = message.replaceAll(secret, '[redacted]')
  return message
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, 'data:image/[redacted]')
    .slice(0, 500)
}
