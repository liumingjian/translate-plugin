import { IMAGE_PRIVACY_DISCLOSURE } from '../shared/constants'
import { validCrop } from '../shared/crop'
import type { CropRect, ResizeHandle, Size } from '../shared/crop'
import {
  CROP_HANDLE_LABELS,
  CROP_HANDLES,
  CropInteractionController,
} from '../shared/cropInteraction'
import type { Point } from '../shared/cropInteraction'

export type ConfirmedScreenshot = {
  imageDataUrl: string
  rect: CropRect
  viewport: Size
}

type ScreenshotModeHandlers = {
  onConfirm: (screenshot: ConfirmedScreenshot) => void
  onCancel?: () => void
  onAcceptPrivacy: () => Promise<boolean>
}

export type ScreenshotModeState =
  | 'awaiting-privacy'
  | 'waiting-for-selection'
  | 'adjusting-selection'
  | 'submitting'
  | 'exited'

const SCREENSHOT_STYLES = `
:host { all: initial; }
* {
  box-sizing: border-box;
  font-family: "SF Pro Text", system-ui, -apple-system, BlinkMacSystemFont,
    "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  letter-spacing: 0;
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
  border: 2px solid #2997ff;
  background: rgba(0, 102, 204, .08);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, .45);
  cursor: move;
  outline: none;
}
.selection.visible { display: block; }
.selection:focus-visible { outline: 3px solid #ffffff; outline-offset: 2px; }
.handle {
  position: absolute;
  width: 12px;
  height: 12px;
  border: 2px solid #0066cc;
  border-radius: 50%;
  background: #fff;
  padding: 0;
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
  width: min(420px, calc(100vw - 16px));
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid #454547;
  border-radius: 8px;
  background: rgba(0, 0, 0, .92);
  color: #fff;
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
  padding: 5px 13px;
  border: 1px solid #7a7a7a;
  border-radius: 9999px;
  background: transparent;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
button:hover:not(:disabled) { background: #272729; }
button.primary { border-color: #0066cc; background: #0066cc; }
button.primary:hover:not(:disabled) { border-color: #0071e3; background: #0071e3; }
button:disabled { opacity: .45; cursor: default; }
button:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
.selection .handle { min-height: 12px; padding: 0; }
.selection .handle:focus-visible { outline: 2px solid #ffffff; box-shadow: 0 0 0 4px #2997ff; }
.privacy {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(420px, calc(100vw - 24px));
  padding: 20px;
  border: 1px solid #454547;
  border-radius: 8px;
  background: #272729;
  color: #fff;
  cursor: default;
}
.privacy.hidden { display: none; }
.privacy h2 { margin: 0 0 10px; font-size: 18px; line-height: 1.4; }
.privacy p { margin: 0 0 16px; font-size: 14px; line-height: 1.6; }
.privacy-actions { display: flex; justify-content: flex-end; gap: 8px; }
.surface[data-state="awaiting-privacy"] .toolbar { opacity: .35; }
@media (max-width: 420px) {
  .toolbar { flex-wrap: wrap; bottom: 8px; }
  .status { width: 100%; flex-basis: 100%; white-space: normal; }
  .toolbar button { flex: 1 1 auto; }
  .privacy { padding: 17px; }
  .privacy-actions { flex-wrap: wrap; }
  .privacy-actions button { flex: 1 1 auto; }
}
`

export class ScreenshotMode {
  private readonly host = document.createElement('div')
  private readonly surface = document.createElement('div')
  private readonly frozenImage = document.createElement('img')
  private readonly selection = document.createElement('div')
  private readonly status = document.createElement('span')
  private readonly toolbar = document.createElement('div')
  private readonly confirmButton = document.createElement('button')
  private readonly privacyPanel = document.createElement('section')
  private readonly privacyAcceptButton = document.createElement('button')
  private readonly interaction: CropInteractionController
  private previousFocus: HTMLElement | null = null
  private imageDataUrl: string | null = null
  private state: ScreenshotModeState = 'exited'

  constructor(private readonly handlers: ScreenshotModeHandlers) {
    this.interaction = new CropInteractionController(() => this.render())
    this.host.style.setProperty('all', 'initial')
    this.host.style.setProperty('position', 'fixed')
    this.host.style.setProperty('inset', '0')
    this.host.style.setProperty('z-index', '2147483647')

    const root = this.host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = SCREENSHOT_STYLES
    this.surface.className = 'surface'
    this.surface.setAttribute('role', 'dialog')
    this.surface.setAttribute('aria-modal', 'true')
    this.surface.setAttribute('aria-label', '截图翻译框选')
    this.surface.tabIndex = -1
    this.frozenImage.className = 'frozen'
    this.frozenImage.alt = '当前页面的冻结画面'
    this.frozenImage.draggable = false
    this.selection.className = 'selection'
    this.selection.setAttribute('role', 'group')
    this.selection.setAttribute('aria-description', '使用方向键移动框选区域')
    this.selection.tabIndex = 0
    for (const handle of CROP_HANDLES) {
      const element = document.createElement('button')
      element.type = 'button'
      element.className = `handle handle-${handle}`
      element.dataset.handle = handle
      element.setAttribute('aria-label', CROP_HANDLE_LABELS[handle])
      element.setAttribute('aria-description', '使用方向键调整')
      element.addEventListener('keydown', (event) => this.adjustWithKeyboard(event, handle))
      this.selection.append(element)
    }

    this.toolbar.className = 'toolbar'
    this.toolbar.addEventListener('pointerdown', (event) => event.stopPropagation())
    this.status.className = 'status'
    this.status.setAttribute('role', 'status')
    this.status.setAttribute('aria-live', 'polite')
    const selectViewportButton = document.createElement('button')
    selectViewportButton.type = 'button'
    selectViewportButton.textContent = '选择可见区域'
    selectViewportButton.addEventListener('click', () => this.selectViewport())
    const cancelButton = document.createElement('button')
    cancelButton.type = 'button'
    cancelButton.textContent = '取消'
    cancelButton.addEventListener('click', () => this.cancel())
    this.confirmButton.className = 'primary'
    this.confirmButton.type = 'button'
    this.confirmButton.textContent = '确认截图'
    this.confirmButton.disabled = true
    this.confirmButton.addEventListener('click', () => this.confirm())
    this.toolbar.append(this.status, selectViewportButton, cancelButton, this.confirmButton)

    this.privacyPanel.className = 'privacy hidden'
    this.privacyPanel.setAttribute('role', 'document')
    const privacyTitle = document.createElement('h2')
    privacyTitle.textContent = '图片上传说明'
    const privacyText = document.createElement('p')
    privacyText.textContent = IMAGE_PRIVACY_DISCLOSURE
    const privacyActions = document.createElement('div')
    privacyActions.className = 'privacy-actions'
    const privacyCancelButton = document.createElement('button')
    privacyCancelButton.type = 'button'
    privacyCancelButton.textContent = '取消'
    privacyCancelButton.addEventListener('click', () => this.cancel())
    this.privacyAcceptButton.type = 'button'
    this.privacyAcceptButton.className = 'primary'
    this.privacyAcceptButton.textContent = '同意并继续'
    this.privacyAcceptButton.addEventListener('click', () => void this.acceptPrivacy())
    privacyActions.append(privacyCancelButton, this.privacyAcceptButton)
    this.privacyPanel.append(privacyTitle, privacyText, privacyActions)

    this.surface.append(this.frozenImage, this.selection, this.toolbar, this.privacyPanel)
    root.append(style, this.surface)

    this.surface.addEventListener('pointerdown', (event) => this.beginSelection(event))
    this.surface.addEventListener('pointermove', (event) => this.updateSelection(event))
    this.surface.addEventListener('pointerup', (event) => this.endSelection(event))
    this.surface.addEventListener('pointercancel', (event) => this.endPointer(event.pointerId))
    this.surface.addEventListener('dblclick', (event) => this.handleDoubleClick(event))
    this.selection.addEventListener('keydown', (event) => this.adjustWithKeyboard(event))
    window.addEventListener('keydown', (event) => this.handleKeydown(event), true)
  }

  get active(): boolean {
    return this.host.isConnected
  }

  get currentState(): ScreenshotModeState {
    return this.state
  }

  begin(imageDataUrl: string, privacyAccepted = true): void {
    this.cancel()
    this.previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    this.imageDataUrl = imageDataUrl
    this.frozenImage.src = imageDataUrl
    this.selection.classList.remove('visible')
    this.confirmButton.disabled = true
    this.status.textContent = '拖动鼠标创建框选区域'
    this.privacyPanel.classList.toggle('hidden', privacyAccepted)
    this.setState(privacyAccepted ? 'waiting-for-selection' : 'awaiting-privacy')
    document.documentElement.append(this.host)
    this.interaction.setBounds(this.bounds())
    this.interaction.setRect(null)
    if (privacyAccepted) this.surface.focus({ preventScroll: true })
    else this.privacyAcceptButton.focus({ preventScroll: true })
  }

  cancel(): void {
    if (this.state === 'exited') return
    const notify = this.state !== 'submitting'
    this.setState('exited')
    this.endPointer()
    this.host.remove()
    this.frozenImage.removeAttribute('src')
    this.imageDataUrl = null
    this.interaction.setRect(null)
    this.privacyPanel.classList.add('hidden')
    const restoreFocus = this.previousFocus
    this.previousFocus = null
    if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true })
    if (notify) this.handlers.onCancel?.()
  }

  private beginSelection(event: PointerEvent): void {
    if (event.button !== 0 || !this.active ||
      this.state === 'submitting' || this.state === 'awaiting-privacy') return
    event.preventDefault()
    const point = this.point(event)
    const target = event.target instanceof HTMLElement ? event.target : null
    const handle = target?.dataset.handle as ResizeHandle | undefined
    const action = handle ?? (this.interaction.getRect() && target && this.selection.contains(target)
      ? 'move'
      : 'create')
    this.interaction.setBounds(this.bounds())
    this.interaction.begin(point, action)
    this.setState('adjusting-selection')
    this.surface.setPointerCapture(event.pointerId)
    this.render()
  }

  private updateSelection(event: PointerEvent): void {
    if (!this.surface.hasPointerCapture(event.pointerId)) return
    this.interaction.setBounds(this.bounds())
    this.interaction.update(this.point(event))
  }

  private endSelection(event: PointerEvent): void {
    this.updateSelection(event)
    this.endPointer(event.pointerId)
  }

  private endPointer(pointerId?: number): void {
    if (pointerId !== undefined && this.surface.hasPointerCapture(pointerId)) {
      this.surface.releasePointerCapture(pointerId)
    }
    this.interaction.end()
  }

  private point(event: PointerEvent): Point {
    return { x: event.clientX, y: event.clientY }
  }

  private bounds(): Size {
    return { width: this.surface.clientWidth, height: this.surface.clientHeight }
  }

  private render(): void {
    const rect = this.interaction.getRect()
    if (!rect) return
    this.selection.classList.add('visible')
    this.selection.style.left = `${rect.x}px`
    this.selection.style.top = `${rect.y}px`
    this.selection.style.width = `${rect.width}px`
    this.selection.style.height = `${rect.height}px`
    const valid = validCrop(rect)
    this.selection.setAttribute(
      'aria-label',
      `${Math.round(rect.width)} x ${Math.round(rect.height)} 的框选区域`,
    )
    this.confirmButton.disabled = !valid
    this.status.textContent = valid
      ? `${Math.round(rect.width)} x ${Math.round(rect.height)}，点击确认截图`
      : '框选区域太小，请继续拖动'
  }

  private selectViewport(): void {
    const bounds = this.bounds()
    const inset = Math.min(2, bounds.width / 2, bounds.height / 2)
    this.interaction.setBounds(bounds)
    this.interaction.selectWholeBounds(inset)
    this.setState('adjusting-selection')
    this.render()
    this.selection.focus({ preventScroll: true })
  }

  private adjustWithKeyboard(event: KeyboardEvent, handle?: ResizeHandle): void {
    if (!this.interaction.getRect() || !isArrowKey(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    this.interaction.setBounds(this.bounds())
    this.interaction.adjust(event.key, event.shiftKey ? 10 : 1, handle)
  }

  private confirm(): void {
    const rect = this.interaction.getRect()
    if (this.state !== 'adjusting-selection' || !this.imageDataUrl || !validCrop(rect)) return
    this.setState('submitting')
    const confirmed = {
      imageDataUrl: this.imageDataUrl,
      rect,
      viewport: this.bounds(),
    }
    this.cancel()
    this.handlers.onConfirm(confirmed)
  }

  private handleDoubleClick(event: MouseEvent): void {
    if (!this.interaction.contains({ x: event.clientX, y: event.clientY })) return
    event.preventDefault()
    this.confirm()
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (!this.active || (event.key !== 'Escape' && event.key !== 'Enter')) return
    if (event.key === 'Enter' && event.composedPath()[0] instanceof HTMLButtonElement) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.key === 'Escape') this.cancel()
    else this.confirm()
  }

  private setState(state: ScreenshotModeState): void {
    this.state = state
    this.surface.dataset.state = state
    this.toolbar.inert = state === 'awaiting-privacy'
    this.privacyPanel.inert = state !== 'awaiting-privacy'
  }

  private async acceptPrivacy(): Promise<void> {
    if (this.state !== 'awaiting-privacy') return
    this.privacyAcceptButton.disabled = true
    const accepted = await this.handlers.onAcceptPrivacy().catch(() => false)
    this.privacyAcceptButton.disabled = false
    if (!accepted || this.state !== 'awaiting-privacy') return
    this.privacyPanel.classList.add('hidden')
    this.setState('waiting-for-selection')
    this.surface.focus({ preventScroll: true })
  }
}

function isArrowKey(key: string): key is import('../shared/crop').ArrowKey {
  return key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown'
}
