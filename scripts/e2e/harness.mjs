import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const DIST = path.join(ROOT, 'dist')
export const FIXTURES = path.join(ROOT, 'tests', 'fixtures')
export const CHROME =
  process.env.TP_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

export function loadRealServiceEnv() {
  const envFile = process.env.TP_ENV_FILE ?? path.join(path.dirname(ROOT), 'translate-plugin', '.env.local')
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile)
  return {
    baseUrl: process.env.TP_BASE_URL || process.env.OPENAI_BASE_URL || '',
    apiKey: process.env.TP_API_KEY || process.env.OPENAI_API_KEY || '',
  }
}

export async function launchExtension() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: process.env.TP_HEADLESS === '0' ? false : true,
    pipe: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check'],
  })
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
  return { browser, extensionOrigin, worker }
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
