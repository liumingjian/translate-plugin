import { MAX_SELECTION_LENGTH, UNKNOWN_LANG_LABEL } from '../shared/constants'
import { langName } from '../shared/lang'
import { anchorBottomRight, type Rect } from '../shared/position'
import type { TranslationErrorKind } from '../shared/types'
import { STYLES } from './styles'

export type OverlayHandlers = {
  onIconClick: () => void
  onRetry: () => void
  onOpenOptions: () => void
  /** 用户点卡片右上角的关闭按钮。 */
  onCardClose: () => void
}

type ErrorSpec = {
  message: string
  retry: boolean
  options: boolean
}

const ERRORS: Record<TranslationErrorKind, ErrorSpec> = {
  'no-api-key': { message: '还没有配置 api-key', retry: false, options: true },
  auth: { message: '鉴权失败，请检查 api-key', retry: true, options: true },
  network: { message: '请求失败', retry: true, options: false },
  unavailable: { message: '翻译服务暂时不可用，稍后再试', retry: true, options: false },
  empty: { message: '模型没有返回译文', retry: true, options: false },
  'too-long': {
    message: `选区超过 ${MAX_SELECTION_LENGTH} 字符，已取消翻译`,
    retry: false,
    options: false,
  },
  'image-too-small': { message: '框选区域太小', retry: false, options: false },
  'image-too-large': { message: '图片过大', retry: false, options: false },
  'image-unsupported': { message: '截图模型不支持图片', retry: false, options: true },
  'no-text': { message: '未识别到可翻译文字', retry: true, options: false },
}

/** 划词图标与翻译卡片。整体活在一个 open Shadow DOM 里。 */
export class Overlay {
  private readonly host = document.createElement('div')
  private readonly root: ShadowRoot
  private readonly icon = document.createElement('button')
  private readonly card = document.createElement('div')
  private readonly title = document.createElement('span')
  private readonly sourceBlock = document.createElement('div')
  private readonly badge = document.createElement('div')
  private readonly resultBlock = document.createElement('div')
  private readonly resultText = document.createElement('div')
  private readonly actions = document.createElement('div')
  private readonly copyButton = document.createElement('button')
  private readonly retryButton = document.createElement('button')
  private readonly optionsButton = document.createElement('button')
  /** 最近一次定位用的锚点 —— 卡片内容变高时要照着它重新摆一次。 */
  private anchor: Rect | null = null
  private refitQueued = false
  private flashTimer: number | null = null
  private flashLabel: string | null = null
  private imageCard = false

  constructor(private readonly handlers: OverlayHandlers) {
    this.host.style.setProperty('all', 'initial')
    this.host.style.setProperty('position', 'absolute')
    this.host.style.setProperty('top', '0')
    this.host.style.setProperty('left', '0')
    this.host.style.setProperty('width', '0')
    this.host.style.setProperty('height', '0')
    this.host.style.setProperty('z-index', '2147483647')

    this.root = this.host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = STYLES
    this.root.append(style, this.buildIcon(), this.buildCard())
    document.documentElement.append(this.host)
  }

  /** 判断某个事件是否发生在浮层内部 —— 用于避免自己把自己关掉。 */
  contains(target: EventTarget | null): boolean {
    return target instanceof Node && this.host.contains(target)
  }

  showIcon(anchor: Rect): void {
    this.icon.classList.remove('hidden')
    this.place(this.icon, anchor, { width: 28, height: 28 })
  }

  hideIcon(): void {
    this.icon.classList.add('hidden')
  }

  get iconVisible(): boolean {
    return !this.icon.classList.contains('hidden')
  }

  get cardVisible(): boolean {
    return !this.card.classList.contains('hidden')
  }

  openCard(sourceText: string, anchor: Rect): void {
    this.imageCard = false
    this.title.textContent = '划词翻译'
    this.sourceBlock.textContent = sourceText
    this.setLang(undefined, undefined)
    this.setLoading()
    this.card.classList.remove('hidden')
    this.reposition(anchor)
  }

  openImageCard(imageDataUrl: string, anchor: Rect): void {
    this.imageCard = true
    this.title.textContent = '截图翻译'
    this.sourceBlock.textContent = ''
    const preview = document.createElement('img')
    preview.className = 'screenshot-preview'
    preview.src = imageDataUrl
    preview.alt = '已确认的截图'
    this.sourceBlock.append(preview)
    this.setLang(undefined, undefined)
    this.setLoading()
    this.card.classList.remove('hidden')
    this.reposition(anchor)
  }

  reposition(anchor: Rect): void {
    this.anchor = anchor
    if (!this.cardVisible) return
    const size = this.card.getBoundingClientRect()
    this.place(this.card, anchor, { width: size.width, height: size.height })
  }

  hideCard(): void {
    this.card.classList.add('hidden')
  }

  setLang(source: string | undefined, target: string | undefined): void {
    const left = source ? langName(source) : UNKNOWN_LANG_LABEL
    const right = target ? langName(target) : UNKNOWN_LANG_LABEL
    this.badge.textContent = `${left} → ${right}`
  }

  setLoading(): void {
    this.resultText.textContent = ''
    this.resultText.className = 'dots'
    this.resultBlock.classList.remove('error')
    this.copyButton.classList.add('hidden')
    this.retryButton.classList.add('hidden')
    this.optionsButton.classList.add('hidden')
  }

  appendDelta(text: string): void {
    if (this.resultText.className === 'dots') this.resultText.className = ''
    this.resultText.textContent = (this.resultText.textContent ?? '') + text
    this.refit()
  }

  finish(): void {
    if (this.resultText.className === 'dots') this.resultText.className = ''
    this.copyButton.classList.remove('hidden')
    this.retryButton.classList.toggle('hidden', this.imageCard)
    this.refit()
  }

  /**
   * 卡片长高之后重新贴一次锚点。流式译文是一行行长出来的，
   * 只在 openCard 时摆一次会让卡片底部（含按钮）掉出视口。
   * 按帧节流，避免每个 delta 都强制一次布局。
   */
  private refit(): void {
    if (this.refitQueued || !this.cardVisible || !this.anchor) return
    this.refitQueued = true
    requestAnimationFrame(() => {
      this.refitQueued = false
      if (this.anchor) this.reposition(this.anchor)
    })
  }

  showError(kind: TranslationErrorKind, detail?: string): void {
    const spec = ERRORS[kind]
    this.resultText.className = 'error'
    this.resultText.textContent = detail ? `${spec.message}：${detail}` : spec.message
    this.copyButton.classList.add('hidden')
    this.retryButton.classList.toggle('hidden', !spec.retry)
    this.optionsButton.classList.toggle('hidden', !spec.options)
    this.refit()
  }

  private buildIcon(): HTMLElement {
    this.icon.className = 'icon hidden'
    this.icon.type = 'button'
    this.icon.title = '翻译选中文字'
    this.icon.textContent = '译'
    // 在 mousedown 阶段就阻止默认行为，否则点击会清掉选区。
    this.icon.addEventListener('mousedown', (event) => event.preventDefault())
    this.icon.addEventListener('click', (event) => {
      event.stopPropagation()
      this.handlers.onIconClick()
    })
    return this.icon
  }

  private buildCard(): HTMLElement {
    this.card.className = 'card hidden'
    this.card.addEventListener('mousedown', (event) => event.stopPropagation())

    const header = document.createElement('div')
    header.className = 'header'
    this.title.textContent = '划词翻译'
    const close = document.createElement('button')
    close.className = 'close'
    close.type = 'button'
    close.title = '关闭'
    close.textContent = '×'
    close.addEventListener('click', () => {
      this.hideCard()
      this.handlers.onCardClose()
    })
    header.append(this.title, close)

    this.sourceBlock.className = 'block source'
    this.badge.className = 'badge'
    this.resultBlock.className = 'block result'
    this.resultBlock.append(this.resultText)

    this.actions.className = 'actions'
    this.copyButton.className = 'action hidden'
    this.copyButton.type = 'button'
    this.copyButton.textContent = '复制译文'
    this.copyButton.addEventListener('click', () => void this.copyResult())

    this.retryButton.className = 'action hidden'
    this.retryButton.type = 'button'
    this.retryButton.textContent = '重试'
    this.retryButton.addEventListener('click', () => this.handlers.onRetry())

    this.optionsButton.className = 'action primary hidden'
    this.optionsButton.type = 'button'
    this.optionsButton.textContent = '去配置'
    this.optionsButton.addEventListener('click', () => this.handlers.onOpenOptions())

    this.actions.append(this.optionsButton, this.retryButton, this.copyButton)
    this.card.append(header, this.sourceBlock, this.badge, this.resultBlock, this.actions)
    return this.card
  }

  private async copyResult(): Promise<void> {
    const text = this.resultText.textContent ?? ''
    if (text === '') return
    try {
      await navigator.clipboard.writeText(text)
      this.flash(this.copyButton, '已复制')
    } catch {
      this.flash(this.copyButton, '复制失败')
    }
  }

  private flash(button: HTMLButtonElement, label: string): void {
    // 1.2s 内再点一次时，别把「已复制」当成原始文案存下来。
    if (this.flashTimer !== null) window.clearTimeout(this.flashTimer)
    const original = this.flashLabel ?? button.textContent
    this.flashLabel = original
    button.textContent = label
    this.flashTimer = window.setTimeout(() => {
      this.flashTimer = null
      this.flashLabel = null
      button.textContent = original
    }, 1200)
  }

  private place(element: HTMLElement, anchor: Rect, size: { width: number; height: number }): void {
    const placement = anchorBottomRight({
      anchor,
      size,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    })
    element.style.left = `${placement.left}px`
    element.style.top = `${placement.top}px`
  }
}
