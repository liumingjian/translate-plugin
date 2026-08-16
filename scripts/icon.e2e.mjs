/**
 * 划词图标的回归用例：把常见的选区来源和页面结构都过一遍，看图标出不出来。
 * 用法：node scripts/icon.e2e.mjs（不需要 api-key，先 pnpm build）
 * 每个场景输出一行 JSON，visible=false 即回归。
 */
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const CHROME =
  process.env.TP_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const FRAME = `<!doctype html><html lang="en"><head><meta charset="utf-8"></head>
<body style="font:16px/1.7 sans-serif;margin:8px">
<p id="fp">Paragraph living inside an iframe document.</p>
</body></html>`

const page = (origin) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title>
<style>body{font:16px/1.7 -apple-system,sans-serif;max-width:760px;margin:40px auto;padding:0 20px}
#tall{height:1500px}
textarea,input{width:100%;font:16px/1.7 sans-serif}
#sd{border:1px solid #ccc;padding:8px}
iframe{display:block;width:100%;height:90px;border:1px solid #ccc}
</style></head><body>
<p id="en">Every token in your AGENTS.md file gets loaded on every single request.</p>
<p id="two">Second paragraph with more English words to select here.</p>
<textarea id="ta" rows="3">Editable text inside a textarea element.</textarea>
<input id="in" value="Text inside an input element."/>
<div id="sd"></div>
<iframe id="same" src="/frame"></iframe>
<iframe id="cross" src="${origin}frame"></iframe>
<iframe id="srcdoc" srcdoc='<p id="fp" style="font:16px/1.7 sans-serif">Paragraph inside a srcdoc iframe.</p>'></iframe>
<div id="tall"></div>
<p id="bottom">Bottom paragraph after a long scroll region.</p>
<script>
  const sd = document.getElementById('sd').attachShadow({mode:'open'})
  sd.innerHTML = '<p id="sp">Text living inside an open shadow root.</p>'
</script>
</body></html>`

const log = (o) => console.log(JSON.stringify(o))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 跨源 iframe 用同一个服务器的另一个主机名（localhost vs 127.0.0.1）来造。
const serve = (body) => (_, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(body)
}
const server = http.createServer((req, res) => {
  const origin = `http://localhost:${server.address().port}/`
  serve(req.url === '/frame' ? FRAME : page(origin))(req, res)
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

/** 每个框架各有一套浮层，探针得指定在哪个框架里找。 */
const PROBE = () => {
  const host = [...document.documentElement.children].find((e) =>
    e.shadowRoot?.querySelector('.icon'),
  )
  if (!host) return { host: false }
  const icon = host.shadowRoot.querySelector('.icon')
  const card = host.shadowRoot.querySelector('.card')
  const r = icon.getBoundingClientRect()
  const sel = getSelection()
  return {
    visible: !icon.classList.contains('hidden'),
    rect: { x: Math.round(r.x), y: Math.round(r.y) },
    inView: r.x >= 0 && r.y >= 0 && r.x < innerWidth && r.y < innerHeight,
    cardVisible: !card.classList.contains('hidden'),
    sel: String(sel).slice(0, 30),
    active: (() => {
      let el = document.activeElement
      while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
      const range = el && 'selectionStart' in el ? [el.selectionStart, el.selectionEnd] : null
      return el ? el.tagName + (range ? ':' + range.join('-') : '') : null
    })(),
  }
}

try {
  const cdp = await browser.target().createCDPSession()
  await cdp.send('Extensions.loadUnpacked', { path: DIST })
  await sleep(2000)
  const tab = await browser.newPage()
  await tab.setViewport({ width: 1100, height: 800 })
  tab.on('pageerror', (e) => log({ pageError: e.message.slice(0, 300) }))
  await tab.goto(origin, { waitUntil: 'networkidle2' })
  await sleep(1500)

  /** 目标框架：null 表示主文档，否则是某个 iframe 元素的 id。 */
  const frameOf = async (frameId) => {
    if (!frameId) return { frame: tab.mainFrame(), offset: { x: 0, y: 0 } }
    const handle = await tab.$(`#${frameId}`)
    const frame = await handle.contentFrame()
    const offset = await tab.evaluate((id) => {
      const r = document.getElementById(id).getBoundingClientRect()
      return { x: r.x, y: r.y }
    }, frameId)
    return { frame, offset }
  }

  const probe = (frame) => frame.evaluate(PROBE)

  const boxIn = (frame, selector) =>
    frame.evaluate((s) => {
      const el = s.startsWith('shadow:')
        ? document.getElementById('sd').shadowRoot.getElementById(s.slice(7))
        : document.querySelector(s)
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    }, selector)

  const clear = async () => {
    for (const frame of tab.frames()) {
      await frame.evaluate(() => getSelection()?.removeAllRanges()).catch(() => {})
    }
    await tab.mouse.click(5, 5)
    await sleep(300)
  }

  /** 坐标要换算到主文档：page.mouse 只认顶层视口。 */
  const drag = async (box, offset, dy = box.h / 2) => {
    const y = offset.y + box.y + dy
    await tab.mouse.move(offset.x + box.x + 2, y)
    await tab.mouse.down()
    await tab.mouse.move(offset.x + box.x + Math.max(30, box.w - 30), y, { steps: 12 })
    await tab.mouse.up()
    await sleep(700)
  }

  const scenario = async (name, frameId, fn) => {
    await clear()
    const { frame, offset } = await frameOf(frameId)
    await fn({ frame, offset })
    log({ scenario: name, ...(await probe(frame)) })
  }

  const dragScenario = (name, frameId, selector, dy) =>
    scenario(name, frameId, async ({ frame, offset }) =>
      drag(await boxIn(frame, selector), offset, dy),
    )

  await dragScenario('drag-paragraph', null, '#en')
  await dragScenario('textarea', null, '#ta', 12)
  await dragScenario('input', null, '#in')
  await dragScenario('shadow-dom-text', null, 'shadow:sp')
  await dragScenario('iframe-same-origin', 'same', '#fp')
  await dragScenario('iframe-cross-origin', 'cross', '#fp')
  await dragScenario('iframe-srcdoc', 'srcdoc', '#fp')

  // 点开卡片：iframe 里的卡片被框架视口夹住，但至少得开出来。
  await scenario('iframe-card-opens', 'cross', async ({ frame, offset }) => {
    await drag(await boxIn(frame, '#fp'), offset)
    const before = await probe(frame)
    if (!before.visible) return
    await tab.mouse.click(offset.x + before.rect.x + 14, offset.y + before.rect.y + 14)
    await sleep(800)
  })

  // 点回主文档时，子框架的卡片该自己收掉（它收不到主文档的 mousedown）。
  await scenario('iframe-card-dismissed-from-parent', 'cross', async ({ frame, offset }) => {
    await drag(await boxIn(frame, '#fp'), offset)
    const before = await probe(frame)
    if (before.visible) {
      await tab.mouse.click(offset.x + before.rect.x + 14, offset.y + before.rect.y + 14)
      await sleep(800)
    }
    await tab.mouse.click(600, 60)
    await sleep(500)
  })

  await scenario('second-selection-after-card', null, async ({ frame, offset }) => {
    await drag(await boxIn(frame, '#en'), offset)
    const before = await probe(frame)
    if (before.visible) {
      await tab.mouse.click(before.rect.x + 14, before.rect.y + 14)
      await sleep(800)
    }
    await drag(await boxIn(frame, '#two'), offset)
  })

  await scenario('after-scroll', null, async ({ frame, offset }) => {
    await tab.evaluate(() => scrollTo(0, 1200))
    await sleep(300)
    await drag(await boxIn(frame, '#bottom'), offset)
  })
  await tab.evaluate(() => scrollTo(0, 0))

  // headless 的合成按键不会真触发「双击选词 / Cmd+A 全选」，
  // 所以键盘路径用「建好选区 + 发 keyup」来验，跟 e2e 里一致。
  await scenario('keyboard-selection', null, async ({ frame }) => {
    await frame.evaluate(() => {
      const range = document.createRange()
      range.selectNodeContents(document.getElementById('two'))
      const s = getSelection()
      s.removeAllRanges()
      s.addRange(range)
      document.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
      )
    })
    await sleep(700)
  })

  await scenario('textarea-keyboard', null, async ({ frame }) => {
    await tab.click('#ta')
    await frame.evaluate(() => {
      document.getElementById('ta').setSelectionRange(0, 20)
      document.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
      )
    })
    await sleep(700)
  })
} finally {
  await browser.close()
  server.close()
}
