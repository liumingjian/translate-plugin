/**
 * 划词图标的回归用例：把常见的选区方式和页面结构都过一遍，看图标出不出来。
 * 用法：node scripts/icon.e2e.mjs（不需要 api-key，先 pnpm build）
 * 每个场景输出一行 JSON，visible=false 即回归。
 */
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const CHROME = process.env.TP_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title>
<style>body{font:16px/1.7 -apple-system,sans-serif;max-width:760px;margin:40px auto;padding:0 20px}
#tall{height:1500px}
textarea,input{width:100%;font:16px/1.7 sans-serif}
#sd{border:1px solid #ccc;padding:8px}
</style></head><body>
<p id="en">Every token in your AGENTS.md file gets loaded on every single request.</p>
<p id="two">Second paragraph with more English words to select here.</p>
<textarea id="ta" rows="3">Editable text inside a textarea element.</textarea>
<input id="in" value="Text inside an input element."/>
<div id="sd"></div>
<div id="tall"></div>
<p id="bottom">Bottom paragraph after a long scroll region.</p>
<script>
  const sd = document.getElementById('sd').attachShadow({mode:'open'})
  sd.innerHTML = '<p id="sp">Text living inside an open shadow root.</p>'
</script>
</body></html>`

const log = (o) => console.log(JSON.stringify(o))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const server = http.createServer((_, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(PAGE)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}/`

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: process.env.TP_HEADLESS === '0' ? false : true,
  pipe: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check'],
})

try {
  const cdp = await browser.target().createCDPSession()
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: DIST })
  await sleep(2000)
  const page = await browser.newPage()
  await page.setViewport({ width: 1100, height: 800 })
  page.on('pageerror', (e) => log({ pageError: e.message.slice(0, 300) }))
  await page.goto(origin, { waitUntil: 'load' })
  await sleep(1500)

  const probe = () =>
    page.evaluate(() => {
      const host = [...document.documentElement.children].find((e) => e.shadowRoot?.querySelector('.icon'))
      if (!host) return { host: false }
      const icon = host.shadowRoot.querySelector('.icon')
      const r = icon.getBoundingClientRect()
      const sel = getSelection()
      return {
        visible: !icon.classList.contains('hidden'),
        rect: { x: Math.round(r.x), y: Math.round(r.y) },
        inView: r.x >= 0 && r.y >= 0 && r.x < innerWidth && r.y < innerHeight,
        sel: String(sel).slice(0, 30),
        ranges: sel.rangeCount,
        active: (() => {
          let el = document.activeElement
          while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
          const range = el && 'selectionStart' in el ? [el.selectionStart, el.selectionEnd] : null
          return el ? el.tagName + (range ? ':' + range.join('-') : '') : null
        })(),
      }
    })

  const boxOf = (sel) =>
    page.evaluate((s) => {
      const el = s.startsWith('shadow:')
        ? document.getElementById('sd').shadowRoot.getElementById(s.slice(7))
        : document.querySelector(s)
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    }, sel)

  const clear = async () => {
    await page.evaluate(() => getSelection().removeAllRanges())
    await page.mouse.click(5, 5)
    await sleep(300)
  }

  const drag = async (b, dy = b.h / 2) => {
    await page.mouse.move(b.x + 2, b.y + dy)
    await page.mouse.down()
    await page.mouse.move(b.x + Math.max(30, b.w - 30), b.y + dy, { steps: 12 })
    await page.mouse.up()
    await sleep(700)
  }

  const scenario = async (name, fn) => {
    await clear()
    await fn()
    log({ scenario: name, ...(await probe()) })
  }

  await scenario('drag-paragraph', async () => drag(await boxOf('#en')))
  await scenario('second-selection-after-card', async () => {
    await drag(await boxOf('#en'))
    const st = await probe()
    if (st.visible) {
      const host = await page.evaluate(() => {
        const h = [...document.documentElement.children].find((e) => e.shadowRoot?.querySelector('.icon'))
        const r = h.shadowRoot.querySelector('.icon').getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      })
      await page.mouse.click(host.x, host.y)
      await sleep(800)
    }
    await drag(await boxOf('#two'))
  })
  await scenario('textarea', async () => drag(await boxOf('#ta'), 12))
  await scenario('input', async () => drag(await boxOf('#in')))
  await scenario('shadow-dom-text', async () => drag(await boxOf('shadow:sp')))
  await scenario('after-scroll', async () => {
    await page.evaluate(() => scrollTo(0, 1200))
    await sleep(300)
    await drag(await boxOf('#bottom'))
  })
  await page.evaluate(() => scrollTo(0, 0))
  // headless 的合成按键不会真的触发「双击选词 / Cmd+A 全选」，
  // 所以键盘路径用「建好选区 + 发 keyup」来验，跟 e2e 里一致。
  await scenario('keyboard-selection', async () => {
    await page.evaluate(() => {
      const range = document.createRange()
      range.selectNodeContents(document.getElementById('two'))
      const s = getSelection()
      s.removeAllRanges()
      s.addRange(range)
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true }))
    })
    await sleep(700)
  })
  await scenario('textarea-keyboard', async () => {
    await page.click('#ta')
    await page.evaluate(() => {
      const ta = document.getElementById('ta')
      ta.setSelectionRange(0, 20)
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true }))
    })
    await sleep(700)
  })
} finally {
  await browser.close()
  server.close()
}
