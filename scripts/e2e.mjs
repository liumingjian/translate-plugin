/**
 * 在真实 Chrome 里加载 dist/ 并走一遍主链路。
 * 用法：TP_API_KEY=sk-... node scripts/e2e.mjs
 * 结果以 JSON 行输出；截图写到 TP_SHOT_DIR（默认 /tmp）。
 */
import fs from 'node:fs'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const CHROME =
  process.env.TP_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const API_KEY = process.env.TP_API_KEY ?? ''
const LONG = 'lorem ipsum dolor sit amet '.repeat(200)
const SHOT_DIR = process.env.TP_SHOT_DIR ?? '/tmp'
fs.mkdirSync(SHOT_DIR, { recursive: true })

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title>
<style>body{font:16px/1.7 -apple-system,sans-serif;max-width:760px;margin:40px auto;padding:0 20px}
@media (prefers-color-scheme: dark){body{background:#111;color:#eee}}</style></head><body>
<p id="en">Every token in your AGENTS.md file gets loaded on every single request, regardless of whether it's relevant. This creates a hard budget problem:</p>
<p id="zh">前沿思维型大语言模型可以遵循约 150 到 200 条指令。较小的模型能关注的指令更少。</p>
<p id="q">What is a monad?</p>
<p id="long">${LONG}</p>
</body></html>`

const log = (obj) => console.log(JSON.stringify(obj))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const server = http.createServer((_, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(PAGE)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}/`

// 加载扩展有两个坑，缺一个都会得到「扩展装上了但什么都不发生」：
//   1. 新版 Chrome（151 实测）静默忽略 `--load-extension`，必须走
//      --enable-unsafe-extension-debugging + CDP Extensions.loadUnpacked，
//      而这个 CDP 域只在浏览器级会话上可用，且要求 pipe 连接。
//   2. puppeteer 默认参数里带 `--disable-extensions`，不摘掉的话扩展装了也不运行。
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
  log({ step: 'extension-loaded', extensionId })
  // 扩展刚装上时 content script 的注册还没生效，这时候打开的页面注入不到。
  await sleep(2000)

  // 写扩展配置的三条路都堵着：
  //   - page.goto / Target.createTarget 打开扩展页 -> 没列进 web_accessible_resources，被拦成 chrome-error
  //   - 浏览器级会话上的 Extensions.setStorageItems -> "No associated browser context"
  // 剩下唯一稳的是拿 service worker 的上下文。MV3 的 SW 是懒启动的，
  // 所以要先触发一次翻译把它叫醒（第一个场景「未配置 api-key」正好不需要配置）。
  const setSettings = async (settings) => {
    const target = await browser.waitForTarget(
      (t) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${extensionId}`),
      { timeout: 20_000 },
    )
    const worker = await target.worker()
    await worker.evaluate(async (s) => {
      if (s === null) await chrome.storage.local.clear()
      else await chrome.storage.local.set({ settings: s })
    }, settings)
  }

  const page = await browser.newPage()
  await page.setViewport({ width: 1100, height: 800 })

  /** 选中某个段落并触发 mouseup，返回划词图标是否出现。 */
  const select = async (id) =>
    page.evaluate((elementId) => {
      const el = document.getElementById(elementId)
      const range = document.createRange()
      range.selectNodeContents(el)
      const selection = getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    }, id)

  /** 用键盘方式产生选区：不发 mouseup，只发 keyup，模拟 Shift+方向键选择。 */
  const selectByKeyboard = async (id) =>
    page.evaluate((elementId) => {
      const el = document.getElementById(elementId)
      const range = document.createRange()
      range.selectNodeContents(el)
      const selection = getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
      )
    }, id)

  const shadow = () =>
    page.evaluate(() => {
      const host = [...document.documentElement.children].find((e) =>
        e.shadowRoot?.querySelector('.icon'),
      )
      if (!host) return null
      const icon = host.shadowRoot.querySelector('.icon')
      const card = host.shadowRoot.querySelector('.card')
      const rect = icon.getBoundingClientRect()
      return {
        iconVisible: !icon.classList.contains('hidden'),
        iconCenter: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        cardVisible: !card.classList.contains('hidden'),
        badge: host.shadowRoot.querySelector('.badge').textContent,
        source: host.shadowRoot.querySelector('.source').textContent,
        result: host.shadowRoot.querySelector('.result').textContent,
        isError: !!host.shadowRoot.querySelector('.result .error'),
        buttons: [...host.shadowRoot.querySelectorAll('.action')]
          .filter((b) => !b.classList.contains('hidden'))
          .map((b) => b.textContent),
      }
    })

  /**
   * 选中某段文字并点开翻译卡片。
   * 页面刚加载完时 content script 可能还没挂上 mouseup 监听，
   * 这时候选区事件会被彻底错过 —— 所以要重发，而不是干等。
   */
  const selectAndClick = async (id) => {
    const deadline = Date.now() + 8000
    for (;;) {
      await select(id)
      await sleep(400)
      const state = await shadow()
      if (state?.iconVisible) {
        await page.mouse.click(state.iconCenter.x, state.iconCenter.y)
        return
      }
      if (Date.now() > deadline) throw new Error(`划词图标没有出现（${id}）`)
      await sleep(300)
    }
  }

  /** 等卡片进入稳定状态：有按钮出现即代表流结束或报错。 */
  const settle = async (timeout = 60_000) => {
    const deadline = Date.now() + timeout
    for (;;) {
      const state = await shadow()
      if (state?.cardVisible && state.buttons.length > 0) return state
      if (Date.now() > deadline) return state
      await sleep(300)
    }
  }

  const shot = async (name) => {
    const file = path.join(SHOT_DIR, `${name}.png`)
    await page.screenshot({ path: file })
    log({ step: 'screenshot', file })
  }

  page.on('console', (m) => log({ pageConsole: `${m.type()} ${m.text().slice(0, 160)}` }))
  page.on('pageerror', (e) => log({ pageError: e.message.slice(0, 160) }))

  // 1. 未配置 api-key（全新临时 profile，storage 本来就是空的）
  await page.goto(origin, { waitUntil: 'load' })
  await selectAndClick('en')
  log({ step: 'no-api-key', ...(await settle(10_000)) })
  await shot('no-api-key')

  // 2. 英文段落 → 中文
  await setSettings({ baseUrl: 'https://api.vipsyfw.com', apiKey: API_KEY, model: 'gpt-5.4-mini' })
  await page.reload({ waitUntil: 'load' })
  await selectAndClick('en')
  const en = await settle()
  log({ step: 'en->zh', badge: en.badge, result: en.result, buttons: en.buttons })
  await shot('en-to-zh')

  // 3. 中文段落 → 英文
  await page.reload({ waitUntil: 'load' })
  await selectAndClick('zh')
  const zh = await settle()
  log({ step: 'zh->en', badge: zh.badge, result: zh.result })

  // 4. 疑问句只译不答
  await page.reload({ waitUntil: 'load' })
  await selectAndClick('q')
  const q = await settle()
  log({ step: 'question', badge: q.badge, result: q.result })

  // 5. 缓存命中（同一段文字再来一次，计时）
  await page.reload({ waitUntil: 'load' })
  const started = Date.now()
  await selectAndClick('q')
  const cached = await settle()
  log({ step: 'cache', ms: Date.now() - started, result: cached.result })

  // 6. 超长选区
  await page.reload({ waitUntil: 'load' })
  await selectAndClick('long')
  const long = await settle(10_000)
  log({ step: 'too-long', isError: long.isError, result: long.result, buttons: long.buttons })

  // 7. 深色主题
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
  await page.reload({ waitUntil: 'load' })
  await selectAndClick('en')
  await settle()
  await shot('dark')

  // 8. 键盘选区（Shift+方向键）应当也出划词图标 —— 目前只监听 mouseup，预期红。
  await page.reload({ waitUntil: 'load' })
  await selectAndClick('en') // 先确保 content script 已挂载
  await page.keyboard.press('Escape')
  await page.evaluate(() => getSelection().removeAllRanges())
  await sleep(300)
  await selectByKeyboard('zh')
  await sleep(600)
  const kbd = await shadow()
  log({ step: 'keyboard-selection', iconVisible: !!kbd?.iconVisible, expected: true })

  log({ step: 'done' })
} finally {
  await browser.close()
  server.close()
}
