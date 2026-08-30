import {
  moveRect,
  normalizeRect,
  resizeRect,
  validCrop,
} from '../shared/crop'
import type { CropRect, ResizeHandle, Size } from '../shared/crop'

export type ConfirmedScreenshot = {
  imageDataUrl: string
  rect: CropRect
  viewport: Size
}

type ScreenshotModeHandlers = {
  onConfirm: (screenshot: ConfirmedScreenshot) => void
  onCancel?: () => void
}

export type ScreenshotModeState =
  | 'waiting-for-selection'
  | 'adjusting-selection'
  | 'submitting'
  | 'exited'

type Interaction =
  | { kind: 'create'; start: Point }
  | { kind: 'move'; start: Point; rect: CropRect }
  | { kind: 'resize'; start: Point; rect: CropRect; handle: ResizeHandle }

type Point = { x: number; y: number }

const HANDLES: ResizeHandle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']

const SCREENSHOT_STYLES = `
:host { all: initial; }
* {
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
}
.surface {
  position: fixed;
  inset: 0;
  overflow: hidden;
  cursor: crosshair;
  user-select: none;
  touch-action: none;
}
.frozen {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.selection {
  position: absolute;
  display: none;
  border: 2px solid #4f8cff;
  background: rgba(79, 140, 255, .08);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, .45);
  cursor: move;
}
.selection.visible { display: block; }
.handle {
  position: absolute;
  width: 12px;
  height: 12px;
  border: 2px solid #2563eb;
  border-radius: 2px;
  background: #fff;
}
.handle-n { top: -7px; left: calc(50% - 6px); cursor: ns-resize; }
.handle-ne { top: -7px; right: -7px; cursor: nesw-resize; }
.handle-e { top: calc(50% - 6px); right: -7px; cursor: ew-resize; }
.handle-se { right: -7px; bottom: -7px; cursor: nwse-resize; }
.handle-s { bottom: -7px; left: calc(50% - 6px); cursor: ns-resize; }
.handle-sw { bottom: -7px; left: -7px; cursor: nesw-resize; }
.handle-w { top: calc(50% - 6px); left: -7px; cursor: ew-resize; }
.handle-nw { top: -7px; left: -7px; cursor: nwse-resize; }
.toolbar {
  position: absolute;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  min-width: 260px;
  padding: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(255, 255, 255, .22);
  border-radius: 8px;
  background: rgba(20, 22, 26, .94);
  color: #fff;
  box-shadow: 0 8px 28px rgba(0, 0, 0, .35);
  cursor: default;
}
.status {
  flex: 1;
  font-size: 13px;
  line-height: 1.4;
  white-space: nowrap;
}
button {
  min-height: 32px;
  padding: 5px 12px;
  border: 1px solid rgba(255, 255, 255, .25);
  border-radius: 6px;
  background: transparent;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
button.primary { border-color: transparent; background: #2563eb; }
button:disabled { opacity: .45; cursor: default; }
`

export class ScreenshotMode {
  private readonly host = document.createElement('div')
  private readonly surface = document.createElement('div')
  private readonly frozenImage = document.createElement('img')
  private readonly selection = document.createElement('div')
  private readonly status = document.createElement('span')
  private readonly confirmButton = document.createElement('button')
  private imageDataUrl: string | null = null
  private rect: CropRect | null = null
  private interaction: Interaction | null = null
  private state: ScreenshotModeState = 'exited'

  constructor(private readonly handlers: ScreenshotModeHandlers) {
    this.host.style.setProperty('all', 'initial')
    this.host.style.setProperty('position', 'fixed')
    this.host.style.setProperty('inset', '0')
    this.host.style.setProperty('z-index', '2147483647')

    const root = this.host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = SCREENSHOT_STYLES
    this.surface.className = 'surface'
    this.surface.setAttribute('role', 'dialog')
    this.surface.setAttribute('aria-label', '截图翻译框选')
    this.surface.tabIndex = -1
    this.frozenImage.className = 'frozen'
    this.frozenImage.alt = '当前页面的冻结画面'
    this.frozenImage.draggable = false
    this.selection.className = 'selection'
    this.selection.setAttribute('aria-label', '框选区域')
    for (const handle of HANDLES) {
      const element = document.createElement('span')
      element.className = `handle handle-${handle}`
      element.dataset.handle = handle
      element.setAttribute('aria-hidden', 'true')
      this.selection.append(element)
    }

    const toolbar = document.createElement('div')
    toolbar.className = 'toolbar'
    toolbar.addEventListener('pointerdown', (event) => event.stopPropagation())
    this.status.className = 'status'
    this.status.setAttribute('role', 'status')
    const cancelButton = document.createElement('button')
    cancelButton.type = 'button'
    cancelButton.textContent = '取消'
    cancelButton.addEventListener('click', () => this.cancel())
    this.confirmButton.className = 'primary'
    this.confirmButton.type = 'button'
    this.confirmButton.textContent = '确认截图'
    this.confirmButton.disabled = true
    this.confirmButton.addEventListener('click', () => this.confirm())
    toolbar.append(this.status, cancelButton, this.confirmButton)
    this.surface.append(this.frozenImage, this.selection, toolbar)
    root.append(style, this.surface)

    this.surface.addEventListener('pointerdown', (event) => this.beginSelection(event))
    this.surface.addEventListener('pointermove', (event) => this.updateSelection(event))
    this.surface.addEventListener('pointerup', (event) => this.endSelection(event))
    this.surface.addEventListener('pointercancel', (event) => this.endPointer(event.pointerId))
    this.surface.addEventListener('dblclick', (event) => this.handleDoubleClick(event))
    window.addEventListener('keydown', (event) => this.handleKeydown(event), true)
  }

  get active(): boolean {
    return this.host.isConnected
  }

  get currentState(): ScreenshotModeState {
    return this.state
  }

  begin(imageDataUrl: string): void {
    this.cancel()
    this.imageDataUrl = imageDataUrl
    this.rect = null
    this.interaction = null
    this.frozenImage.src = imageDataUrl
    this.selection.classList.remove('visible')
    this.confirmButton.disabled = true
    this.status.textContent = '拖动鼠标创建框选区域'
    this.setState('waiting-for-selection')
    document.documentElement.append(this.host)
    this.surface.focus({ preventScroll: true })
  }

  cancel(): void {
    if (this.state === 'exited') return
    const notify = this.state !== 'submitting'
    this.setState('exited')
    this.endPointer()
    this.host.remove()
    this.frozenImage.removeAttribute('src')
    this.imageDataUrl = null
    this.rect = null
    if (notify) this.handlers.onCancel?.()
  }

  private beginSelection(event: PointerEvent): void {
    if (event.button !== 0 || !this.active || this.state === 'submitting') return
    event.preventDefault()
    const point = this.point(event)
    const target = event.target instanceof HTMLElement ? event.target : null
    const handle = target?.dataset.handle as ResizeHandle | undefined
    if (handle && this.rect) {
      this.interaction = { kind: 'resize', start: point, rect: { ...this.rect }, handle }
    } else if (this.rect && target && this.selection.contains(target)) {
      this.interaction = { kind: 'move', start: point, rect: { ...this.rect } }
    } else {
      this.interaction = { kind: 'create', start: point }
      this.rect = { x: point.x, y: point.y, width: 0, height: 0 }
    }
    this.setState('adjusting-selection')
    this.surface.setPointerCapture(event.pointerId)
    this.render()
  }

  private updateSelection(event: PointerEvent): void {
    if (!this.interaction || !this.surface.hasPointerCapture(event.pointerId)) return
    const point = this.point(event)
    const dx = point.x - this.interaction.start.x
    const dy = point.y - this.interaction.start.y
    switch (this.interaction.kind) {
      case 'create':
        this.rect = normalizeRect(this.interaction.start, point)
        break
      case 'move':
        this.rect = moveRect(this.interaction.rect, dx, dy, this.bounds())
        break
      case 'resize':
        this.rect = resizeRect(
          this.interaction.rect,
          this.interaction.handle,
          dx,
          dy,
          this.bounds(),
        )
        break
    }
    this.render()
  }

  private endSelection(event: PointerEvent): void {
    if (!this.interaction) return
    this.updateSelection(event)
    this.endPointer(event.pointerId)
  }

  private endPointer(pointerId?: number): void {
    if (pointerId !== undefined && this.surface.hasPointerCapture(pointerId)) {
      this.surface.releasePointerCapture(pointerId)
    }
    this.interaction = null
  }

  private point(event: PointerEvent): Point {
    const bounds = this.bounds()
    return {
      x: clamp(event.clientX, 0, bounds.width),
      y: clamp(event.clientY, 0, bounds.height),
    }
  }

  private bounds(): Size {
    return { width: this.surface.clientWidth, height: this.surface.clientHeight }
  }

  private render(): void {
    if (!this.rect) return
    this.selection.classList.add('visible')
    this.selection.style.left = `${this.rect.x}px`
    this.selection.style.top = `${this.rect.y}px`
    this.selection.style.width = `${this.rect.width}px`
    this.selection.style.height = `${this.rect.height}px`
    const valid = validCrop(this.rect)
    this.confirmButton.disabled = !valid
    this.status.textContent = valid
      ? `${Math.round(this.rect.width)} x ${Math.round(this.rect.height)}，点击确认截图`
      : '框选区域太小，请继续拖动'
  }

  private confirm(): void {
    if (this.state !== 'adjusting-selection' || !this.imageDataUrl || !validCrop(this.rect)) return
    this.setState('submitting')
    const confirmed = {
      imageDataUrl: this.imageDataUrl,
      rect: { ...this.rect },
      viewport: this.bounds(),
    }
    this.cancel()
    this.handlers.onConfirm(confirmed)
  }

  private handleDoubleClick(event: MouseEvent): void {
    if (!this.rect) return
    if (
      event.clientX < this.rect.x || event.clientY < this.rect.y ||
      event.clientX > this.rect.x + this.rect.width ||
      event.clientY > this.rect.y + this.rect.height
    ) return
    event.preventDefault()
    this.confirm()
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (!this.active || (event.key !== 'Escape' && event.key !== 'Enter')) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.key === 'Escape') this.cancel()
    else this.confirm()
  }

  private setState(state: ScreenshotModeState): void {
    this.state = state
    this.surface.dataset.state = state
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
