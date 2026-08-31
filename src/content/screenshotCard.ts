import { UNKNOWN_LANG_LABEL } from '../shared/constants'
import { langName } from '../shared/lang'
import { anchorBottomRight, constrainToViewport, type Rect } from '../shared/position'
import type { TranslationErrorKind } from '../shared/types'
import { SCREENSHOT_CARD_STYLES } from './screenshotCardStyles'

type ScreenshotCardHandlers = {
  onClose: () => void
  onRetry: () => void
  onReselect: () => void
  onOpenOptions: (imageModel: boolean) => void
}

const ERROR_MESSAGES: Record<TranslationErrorKind, string> = {
  'no-api-key': '还没有配置 api-key',
  auth: '鉴权失败，请检查 api-key',
  network: '请求失败',
  unavailable: '翻译服务暂时不可用，稍后再试',
  empty: '模型没有返回译文',
  'too-long': '选区过长',
  'image-too-small': '框选区域太小',
  'image-too-large': '图片过大',
  'image-unsupported': '截图模型不支持图片',
  'image-privacy-required': '请先确认图片上传说明',
  'no-text': '未识别到可翻译文字',
}

/** 独立于划词浮层的、持续驻留的截图翻译结果卡片。 */
export class ScreenshotCard {
  private readonly host = document.createElement('div')
  private readonly card = document.createElement('section')
  private readonly header = document.createElement('header')
  private readonly preview = document.createElement('img')
  private readonly badge = document.createElement('div')
  private readonly result = document.createElement('div')
  private readonly error = document.createElement('div')
  private readonly copyButton = document.createElement('button')
  private readonly retryButton = document.createElement('button')
  private readonly reselectButton = document.createElement('button')
  private readonly optionsButton = document.createElement('button')
  private readonly closeButton = document.createElement('button')
  private readonly announcement = document.createElement('div')
  private anchor: Rect | null = null
  private dragged = false
  private dragPointerId: number | null = null
  private dragOffset = { x: 0, y: 0 }
  private flashTimer: number | null = null
  private previousFocus: HTMLElement | null = null

  constructor(private readonly handlers: ScreenshotCardHandlers) {
    this.host.style.setProperty('all', 'initial')
    this.host.style.setProperty('position', 'absolute')
    this.host.style.setProperty('inset', '0 auto auto 0')
    this.host.style.setProperty('width', '0')
    this.host.style.setProperty('height', '0')
    this.host.style.setProperty('z-index', '2147483646')

    const root = this.host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = SCREENSHOT_CARD_STYLES
    root.append(style, this.buildCard())

    window.addEventListener('keydown', (event) => this.handleKeydown(event), true)
    window.addEventListener('resize', () => this.reposition())
  }

  get visible(): boolean {
    return this.host.isConnected
  }

  open(imageDataUrl: string, anchor: Rect): void {
    this.anchor = anchor
    this.dragged = false
    this.preview.src = imageDataUrl
    this.setLang(undefined, undefined)
    this.setLoading()
    if (!this.visible) {
      this.previousFocus = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
      document.documentElement.append(this.host)
    }
    this.reposition()
    this.closeButton.focus({ preventScroll: true })
  }

  close(): void {
    if (!this.visible) return
    this.host.remove()
    this.anchor = null
    this.preview.removeAttribute('src')
    this.endDrag()
    const restoreFocus = this.previousFocus
    this.previousFocus = null
    if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true })
    this.handlers.onClose()
  }

  setLang(source: string | undefined, target: string | undefined): void {
    const left = source ? langName(source) : UNKNOWN_LANG_LABEL
    const right = target ? langName(target) : UNKNOWN_LANG_LABEL
    this.badge.textContent = `${left} → ${right}`
  }

  setLoading(): void {
    const root = this.card.getRootNode()
    const focused = root instanceof ShadowRoot ? root.activeElement : null
    if (
      focused === this.copyButton || focused === this.retryButton ||
      focused === this.reselectButton || focused === this.optionsButton
    ) this.closeButton.focus({ preventScroll: true })
    this.result.className = 'result dots'
    this.result.textContent = ''
    this.error.classList.add('hidden')
    this.copyButton.classList.add('hidden')
    this.retryButton.classList.add('hidden')
    this.reselectButton.classList.add('hidden')
    this.optionsButton.classList.add('hidden')
    this.card.setAttribute('aria-busy', 'true')
    this.announce('正在翻译截图')
  }

  appendDelta(text: string): void {
    this.result.classList.remove('dots')
    this.result.textContent += text
  }

  finish(): void {
    this.result.classList.remove('dots')
    this.copyButton.classList.remove('hidden')
    this.reselectButton.classList.remove('hidden')
    this.card.setAttribute('aria-busy', 'false')
    this.announce('截图翻译完成')
  }

  showError(kind: TranslationErrorKind, detail?: string): void {
    const message = ERROR_MESSAGES[kind]
    this.result.classList.remove('dots')
    this.error.textContent = detail ? `${message}：${detail}` : message
    this.error.classList.remove('hidden')
    this.copyButton.classList.toggle('hidden', this.result.textContent === '')
    this.retryButton.classList.toggle(
      'hidden',
      kind !== 'network' && kind !== 'unavailable' && kind !== 'empty',
    )
    this.reselectButton.classList.remove('hidden')
    const settingsError = kind === 'no-api-key' || kind === 'auth' || kind === 'image-unsupported'
    this.optionsButton.classList.toggle('hidden', !settingsError)
    this.optionsButton.textContent = kind === 'image-unsupported' ? '配置截图模型' : '打开配置页'
    this.optionsButton.dataset.imageModel = String(kind === 'image-unsupported')
    this.card.setAttribute('aria-busy', 'false')
  }

  private buildCard(): HTMLElement {
    this.card.className = 'card'
    this.card.setAttribute('role', 'dialog')
    this.card.setAttribute('aria-label', '截图翻译结果')
    this.card.setAttribute('aria-labelledby', 'tp-screenshot-card-title')

    this.header.className = 'header'
    const title = document.createElement('span')
    title.className = 'title'
    title.id = 'tp-screenshot-card-title'
    title.textContent = '截图翻译'
    this.closeButton.className = 'close'
    this.closeButton.type = 'button'
    this.closeButton.title = '关闭截图翻译'
    this.closeButton.setAttribute('aria-label', '关闭截图翻译')
    this.closeButton.textContent = '×'
    this.closeButton.addEventListener('pointerdown', (event) => event.stopPropagation())
    this.closeButton.addEventListener('click', () => this.close())
    this.header.append(title, this.closeButton)

    const previewBlock = document.createElement('div')
    previewBlock.className = 'preview'
    this.preview.alt = '已确认的截图'
    this.preview.draggable = false
    previewBlock.append(this.preview)

    this.badge.className = 'badge'
    this.badge.setAttribute('aria-label', '翻译语言方向')
    this.result.className = 'result'
    this.result.setAttribute('role', 'status')
    this.result.setAttribute('aria-live', 'polite')
    this.error.className = 'error hidden'
    this.error.setAttribute('role', 'alert')
    this.announcement.className = 'visually-hidden'
    this.announcement.setAttribute('role', 'status')
    this.announcement.setAttribute('aria-live', 'polite')

    const actions = document.createElement('div')
    actions.className = 'actions'
    this.retryButton.className = 'hidden'
    this.retryButton.type = 'button'
    this.retryButton.textContent = '重试'
    this.retryButton.addEventListener('click', this.handlers.onRetry)
    this.reselectButton.className = 'hidden'
    this.reselectButton.type = 'button'
    this.reselectButton.textContent = '重新框选'
    this.reselectButton.addEventListener('click', this.handlers.onReselect)
    this.optionsButton.className = 'hidden'
    this.optionsButton.type = 'button'
    this.optionsButton.addEventListener('click', () => {
      this.handlers.onOpenOptions(this.optionsButton.dataset.imageModel === 'true')
    })
    this.copyButton.className = 'hidden'
    this.copyButton.type = 'button'
    this.copyButton.textContent = '复制译文'
    this.copyButton.addEventListener('click', () => void this.copyResult())
    actions.append(this.optionsButton, this.reselectButton, this.retryButton, this.copyButton)

    this.header.addEventListener('pointerdown', (event) => this.beginDrag(event))
    this.header.addEventListener('pointermove', (event) => this.moveDrag(event))
    this.header.addEventListener('pointerup', (event) => this.endDrag(event.pointerId))
    this.header.addEventListener('pointercancel', (event) => this.endDrag(event.pointerId))

    this.card.append(
      this.header,
      previewBlock,
      this.badge,
      this.result,
      this.error,
      actions,
      this.announcement,
    )
    return this.card
  }

  private beginDrag(event: PointerEvent): void {
    if (event.button !== 0 || event.target instanceof HTMLButtonElement) return
    event.preventDefault()
    const rect = this.card.getBoundingClientRect()
    this.dragPointerId = event.pointerId
    this.dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    this.header.setPointerCapture(event.pointerId)
  }

  private moveDrag(event: PointerEvent): void {
    if (this.dragPointerId !== event.pointerId) return
    event.preventDefault()
    this.dragged = true
    this.placeConstrained(event.clientX - this.dragOffset.x, event.clientY - this.dragOffset.y)
  }

  private endDrag(pointerId?: number): void {
    if (pointerId !== undefined && this.header.hasPointerCapture(pointerId)) {
      this.header.releasePointerCapture(pointerId)
    }
    this.dragPointerId = null
  }

  private reposition(): void {
    if (!this.visible) return
    const size = this.card.getBoundingClientRect()
    if (this.dragged) {
      const current = this.card.getBoundingClientRect()
      this.placeConstrained(current.left, current.top)
      return
    }
    if (!this.anchor) return
    const placement = anchorBottomRight({
      anchor: this.anchor,
      size,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    })
    this.card.style.left = `${placement.left}px`
    this.card.style.top = `${placement.top}px`
  }

  private placeConstrained(left: number, top: number): void {
    const rect = this.card.getBoundingClientRect()
    const position = constrainToViewport({
      left,
      top,
      size: { width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    })
    this.card.style.left = `${position.left}px`
    this.card.style.top = `${position.top}px`
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (!this.visible || event.key !== 'Escape') return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.close()
  }

  private async copyResult(): Promise<void> {
    const text = this.result.textContent ?? ''
    if (text === '') return
    try {
      await navigator.clipboard.writeText(text)
      this.flashCopyButton('已复制')
    } catch {
      this.flashCopyButton(this.copyWithSelection(text) ? '已复制' : '复制失败')
    }
  }

  private copyWithSelection(text: string): boolean {
    const input = document.createElement('textarea')
    input.value = text
    input.setAttribute('aria-hidden', 'true')
    input.style.setProperty('position', 'fixed')
    input.style.setProperty('opacity', '0')
    this.card.append(input)
    input.select()
    const copied = document.execCommand('copy')
    input.remove()
    return copied
  }

  private flashCopyButton(label: string): void {
    if (this.flashTimer !== null) window.clearTimeout(this.flashTimer)
    this.copyButton.textContent = label
    this.announce(label)
    this.flashTimer = window.setTimeout(() => {
      this.flashTimer = null
      this.copyButton.textContent = '复制译文'
    }, 1200)
  }

  private announce(message: string): void {
    this.announcement.textContent = ''
    requestAnimationFrame(() => {
      this.announcement.textContent = message
    })
  }
}
