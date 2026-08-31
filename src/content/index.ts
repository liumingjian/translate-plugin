import type { Rect } from '../shared/position'
import { checkSelection } from '../shared/selection'
import { PORT_NAME } from '../shared/types'
import type { TranslateEvent } from '../shared/types'
import { Overlay } from './overlay'
import { readSelection } from './selectionSource'

/** 当前选区的锚点求值器 —— 每次滚动都重新问一次，图标才跟得住。 */
let anchorRect: (() => Rect | null) | null = null
let anchorText = ''
let tooLong = false
let activePort: chrome.runtime.Port | null = null
/** 是否有一次翻译还在流式进行中 —— 用来区分「用户主动关」和「端口意外断」。 */
let streaming = false

const overlay = new Overlay({
  onIconClick: () => {
    if (anchorText === '') return
    overlay.hideIcon()
    overlay.openCard(preview(anchorText), currentAnchorRect() ?? fallbackRect())
    if (tooLong) {
      overlay.showError('too-long')
      return
    }
    startTranslation(anchorText)
  },
  onRetry: () => {
    if (anchorText === '' || tooLong) return
    overlay.setLoading()
    startTranslation(anchorText)
  },
  onOpenOptions: () => {
    void chrome.runtime.sendMessage({ type: 'open-options' }).catch(() => {})
  },
  onCardClose: () => {
    // 关掉卡片就该停掉还在跑的请求，否则译文白烧 token 也白流。
    closePort()
  },
})

document.addEventListener('mouseup', (event) => {
  if (overlay.contains(event.target)) return
  // 让浏览器先把选区结算完，否则拿到的还是上一次的选区。
  window.setTimeout(captureSelection, 0)
})

document.addEventListener('mousedown', (event) => {
  if (overlay.contains(event.target)) return
  dismiss()
})

/** 会改变选区的按键：Shift+方向/Home/End/PageUp/PageDown，以及 Ctrl/Cmd+A。 */
const SELECTION_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
])

// 只监听 mouseup 的话，键盘选区（Shift+方向键、Ctrl+A）永远不出图标。
document.addEventListener('keyup', (event) => {
  const selects =
    (event.shiftKey && SELECTION_KEYS.has(event.key)) ||
    ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a')
  if (!selects) return
  window.setTimeout(captureSelection, 0)
})

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  dismiss()
})

// 子框架的浮层只能自己收场：用户点回主文档时，这个框架既收不到 mousedown
// 也收不到 Escape，卡片会一直挂在那儿。切标签页不算 —— 那时整页都不可见，
// 回来还想看见译文。
if (window !== window.top) {
  window.addEventListener('blur', () => {
    if (document.visibilityState !== 'visible') return
    dismiss()
  })
}

function dismiss(): void {
  overlay.hideIcon()
  overlay.hideCard()
  closePort()
}

const follow = throttleToFrame(() => {
  const rect = currentAnchorRect()
  if (!rect) {
    overlay.hideIcon()
    return
  }
  if (overlay.iconVisible) overlay.showIcon(rect)
  overlay.reposition(rect)
})

window.addEventListener('scroll', follow, { passive: true, capture: true })
window.addEventListener('resize', follow, { passive: true })

function captureSelection(): void {
  const capture = readSelection()
  if (!capture) {
    overlay.hideIcon()
    return
  }

  const check = checkSelection(capture.text)
  if (!check.ok && check.reason === 'empty') {
    overlay.hideIcon()
    return
  }

  // 超长选区照样出图标：点开后在卡片里明确说明为什么不译，
  // 静默不响应只会让用户以为插件坏了。
  tooLong = !check.ok
  anchorRect = capture.rect
  anchorText = check.ok ? check.text : capture.text.trim()
  const rect = currentAnchorRect()
  if (rect) overlay.showIcon(rect)
}

function currentAnchorRect(): Rect | null {
  return anchorRect?.() ?? null
}

/** 卡片原文区只回显开头一段，避免长选区把卡片撑爆。 */
function preview(text: string): string {
  return text.length > 400 ? `${text.slice(0, 400)}…` : text
}

function fallbackRect(): Rect {
  const x = window.innerWidth / 2
  const y = window.innerHeight / 3
  return { left: x, top: y, right: x, bottom: y }
}

function startTranslation(text: string): void {
  closePort()
  let port: chrome.runtime.Port
  try {
    port = chrome.runtime.connect({ name: PORT_NAME })
  } catch {
    overlay.showError('network', '扩展已更新，请刷新页面')
    return
  }
  activePort = port
  streaming = true

  port.onMessage.addListener((event: TranslateEvent) => {
    switch (event.type) {
      case 'lang':
        overlay.setLang(event.source, event.target)
        break
      case 'delta':
        overlay.appendDelta(event.text)
        break
      case 'done':
        overlay.finish()
        closePort()
        break
      case 'error':
        overlay.showError(event.kind, event.detail)
        closePort()
        break
    }
  })

  port.onDisconnect.addListener(() => {
    if (activePort !== port) return
    activePort = null
    // 我们自己断的端口会先把 streaming 清掉；还留着说明是 service worker
    // 被回收/扩展被更新，得让用户看见，而不是一直转圈。
    if (streaming) {
      streaming = false
      overlay.showError('network', '连接中断，请重试')
    }
  })

  port.postMessage({ type: 'translate', text })
}

function closePort(): void {
  streaming = false
  if (!activePort) return
  try {
    activePort.disconnect()
  } catch {
    // 端口可能已经断了。
  }
  activePort = null
}

function throttleToFrame(fn: () => void): () => void {
  let queued = false
  return () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      fn()
    })
  }
}
