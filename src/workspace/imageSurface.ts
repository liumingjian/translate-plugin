import type { CropRect, ResizeHandle, Size } from '../shared/crop'
import {
  CROP_HANDLE_LABELS,
  CROP_HANDLES,
  CropInteractionController,
} from '../shared/cropInteraction'

export class ImageSurface {
  private readonly interaction: CropInteractionController
  private readonly resizeObserver: ResizeObserver

  constructor(
    private readonly frame: HTMLElement,
    private readonly image: HTMLImageElement,
    private readonly selection: HTMLElement,
    private readonly label: HTMLElement,
    newSelectionButton: HTMLButtonElement,
    private readonly onChange: (rect: CropRect | null) => void,
    private readonly onConfirm: () => void,
  ) {
    this.interaction = new CropInteractionController((rect) => {
      this.render(rect)
      this.onChange(rect)
    })
    selection.tabIndex = 0
    selection.setAttribute('role', 'group')
    for (const handle of CROP_HANDLES) {
      const element = document.createElement('button')
      element.type = 'button'
      element.className = `crop-handle crop-handle-${handle}`
      element.dataset.handle = handle
      element.setAttribute('aria-label', CROP_HANDLE_LABELS[handle])
      element.addEventListener('keydown', (event) => this.adjustWithKeyboard(event, handle))
      selection.append(element)
    }

    frame.addEventListener('pointerdown', this.handlePointerDown)
    frame.addEventListener('pointermove', this.handlePointerMove)
    frame.addEventListener('pointerup', this.handlePointerUp)
    frame.addEventListener('pointercancel', this.handlePointerUp)
    frame.addEventListener('dblclick', this.handleDoubleClick)
    newSelectionButton.addEventListener('click', () => this.beginNewSelection())
    selection.addEventListener('keydown', (event) => this.adjustWithKeyboard(event))

    this.resizeObserver = new ResizeObserver(() => this.syncBounds())
    this.resizeObserver.observe(image)
  }

  resetToWholeImage(): void {
    const bounds = this.readBounds()
    this.interaction.setBounds(bounds)
    this.interaction.setRect(bounds.width > 0 && bounds.height > 0
      ? { x: 0, y: 0, ...bounds }
      : null)
  }

  clear(): void {
    this.interaction.end()
    this.interaction.setBounds({ width: 0, height: 0 })
    this.interaction.setRect(null)
  }

  getSelection(): CropRect | null {
    return this.interaction.getRect()
  }

  getRenderedSize(): Size {
    return this.interaction.getBounds()
  }

  focusSelection(): void {
    this.selection.focus({ preventScroll: true })
  }

  private beginNewSelection(): void {
    const bounds = this.interaction.getBounds()
    this.interaction.setRect({
      x: bounds.width / 4,
      y: bounds.height / 4,
      width: bounds.width / 2,
      height: bounds.height / 2,
    })
    this.focusSelection()
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    const bounds = this.interaction.getBounds()
    if (event.button !== 0 || bounds.width <= 0 || bounds.height <= 0) return
    const point = this.pointFromEvent(event)
    const target = event.target instanceof HTMLElement ? event.target : null
    const handle = target?.dataset.handle as ResizeHandle | undefined
    const action = handle ?? (this.interaction.getRect() && this.selection.contains(target)
      ? 'move'
      : 'create')
    this.interaction.begin(point, action)

    this.frame.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.frame.hasPointerCapture(event.pointerId)) return
    this.interaction.update(this.pointFromEvent(event))
  }

  private readonly handlePointerUp = (event: PointerEvent): void => {
    this.interaction.end()
    if (this.frame.hasPointerCapture(event.pointerId)) this.frame.releasePointerCapture(event.pointerId)
  }

  private readonly handleDoubleClick = (event: MouseEvent): void => {
    const point = this.pointFromClient(event.clientX, event.clientY)
    if (!this.interaction.contains(point)) return
    event.preventDefault()
    this.onConfirm()
  }

  private syncBounds(): void {
    const next = this.readBounds()
    if (next.width <= 0 || next.height <= 0) return
    this.interaction.setBounds(next, true)
  }

  private adjustWithKeyboard(event: KeyboardEvent, handle?: ResizeHandle): void {
    if (!this.interaction.getRect() || !isArrowKey(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    this.interaction.adjust(event.key, event.shiftKey ? 10 : 1, handle)
  }

  private readBounds(): Size {
    const box = this.image.getBoundingClientRect()
    return { width: box.width, height: box.height }
  }

  private pointFromEvent(event: PointerEvent): { x: number; y: number } {
    return this.pointFromClient(event.clientX, event.clientY)
  }

  private pointFromClient(clientX: number, clientY: number): { x: number; y: number } {
    const box = this.frame.getBoundingClientRect()
    return {
      x: clientX - box.left,
      y: clientY - box.top,
    }
  }

  private render(rect: CropRect | null): void {
    if (!rect) {
      this.selection.classList.add('hidden')
      return
    }
    this.selection.classList.remove('hidden')
    this.selection.style.left = `${rect.x}px`
    this.selection.style.top = `${rect.y}px`
    this.selection.style.width = `${rect.width}px`
    this.selection.style.height = `${rect.height}px`
    const bounds = this.interaction.getBounds()
    const whole = rect.x < 0.5 && rect.y < 0.5 &&
      Math.abs(rect.width - bounds.width) < 0.5 &&
      Math.abs(rect.height - bounds.height) < 0.5
    this.selection.setAttribute('aria-label', whole ? '已选择整张图片' : '图片框选区域')
    this.label.textContent = whole ? '整张图片' : '框选区域'
  }
}

function isArrowKey(key: string): key is import('../shared/crop').ArrowKey {
  return key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown'
}
