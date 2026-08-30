import {
  adjustRectWithKeyboard,
  moveRect,
  normalizeRect,
  resizeRect,
  scaleRect,
} from '../shared/crop'
import type { CropRect, ResizeHandle, Size } from '../shared/crop'

type Interaction =
  | { kind: 'create'; start: { x: number; y: number } }
  | { kind: 'move'; start: { x: number; y: number }; rect: CropRect }
  | { kind: 'resize'; start: { x: number; y: number }; rect: CropRect; handle: ResizeHandle }

const HANDLES: ResizeHandle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
const HANDLE_LABELS: Record<ResizeHandle, string> = {
  n: '调整上边界',
  ne: '调整右上角',
  e: '调整右边界',
  se: '调整右下角',
  s: '调整下边界',
  sw: '调整左下角',
  w: '调整左边界',
  nw: '调整左上角',
}

export class ImageSurface {
  private rect: CropRect | null = null
  private bounds: Size = { width: 0, height: 0 }
  private interaction: Interaction | null = null
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
    selection.tabIndex = 0
    selection.setAttribute('role', 'group')
    for (const handle of HANDLES) {
      const element = document.createElement('button')
      element.type = 'button'
      element.className = `crop-handle crop-handle-${handle}`
      element.dataset.handle = handle
      element.setAttribute('aria-label', HANDLE_LABELS[handle])
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
    this.bounds = this.readBounds()
    this.rect = this.bounds.width > 0 && this.bounds.height > 0
      ? { x: 0, y: 0, ...this.bounds }
      : null
    this.render()
    this.onChange(this.getSelection())
  }

  clear(): void {
    this.interaction = null
    this.rect = null
    this.bounds = { width: 0, height: 0 }
    this.render()
    this.onChange(null)
  }

  getSelection(): CropRect | null {
    return this.rect ? { ...this.rect } : null
  }

  getRenderedSize(): Size {
    return { ...this.bounds }
  }

  focusSelection(): void {
    this.selection.focus({ preventScroll: true })
  }

  private beginNewSelection(): void {
    this.interaction = null
    this.rect = {
      x: this.bounds.width / 4,
      y: this.bounds.height / 4,
      width: this.bounds.width / 2,
      height: this.bounds.height / 2,
    }
    this.render()
    this.onChange(this.getSelection())
    this.focusSelection()
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.bounds.width <= 0 || this.bounds.height <= 0) return
    const point = this.pointFromEvent(event)
    const target = event.target instanceof HTMLElement ? event.target : null
    const handle = target?.dataset.handle as ResizeHandle | undefined

    if (handle && this.rect) {
      this.interaction = { kind: 'resize', start: point, rect: { ...this.rect }, handle }
    } else if (this.rect && this.selection.contains(target)) {
      this.interaction = { kind: 'move', start: point, rect: { ...this.rect } }
    } else {
      this.interaction = { kind: 'create', start: point }
      this.rect = { x: point.x, y: point.y, width: 0, height: 0 }
    }

    this.frame.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.interaction || !this.frame.hasPointerCapture(event.pointerId)) return
    const point = this.pointFromEvent(event)
    const dx = point.x - this.interaction.start.x
    const dy = point.y - this.interaction.start.y

    switch (this.interaction.kind) {
      case 'create':
        this.rect = normalizeRect(this.interaction.start, point)
        break
      case 'move':
        this.rect = moveRect(this.interaction.rect, dx, dy, this.bounds)
        break
      case 'resize':
        this.rect = resizeRect(
          this.interaction.rect,
          this.interaction.handle,
          dx,
          dy,
          this.bounds,
        )
        break
    }
    this.render()
    this.onChange(this.getSelection())
  }

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (!this.interaction) return
    this.interaction = null
    if (this.frame.hasPointerCapture(event.pointerId)) this.frame.releasePointerCapture(event.pointerId)
  }

  private readonly handleDoubleClick = (event: MouseEvent): void => {
    if (!this.rect) return
    const point = this.pointFromClient(event.clientX, event.clientY)
    if (
      point.x < this.rect.x || point.y < this.rect.y ||
      point.x > this.rect.x + this.rect.width ||
      point.y > this.rect.y + this.rect.height
    ) return
    event.preventDefault()
    this.onConfirm()
  }

  private syncBounds(): void {
    const next = this.readBounds()
    if (next.width <= 0 || next.height <= 0) return
    if (this.rect && this.bounds.width > 0 && this.bounds.height > 0) {
      this.rect = scaleRect(this.rect, this.bounds, next)
    }
    this.bounds = next
    this.render()
  }

  private adjustWithKeyboard(event: KeyboardEvent, handle?: ResizeHandle): void {
    if (!this.rect || !isArrowKey(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    this.rect = adjustRectWithKeyboard(
      this.rect,
      event.key,
      this.bounds,
      event.shiftKey ? 10 : 1,
      handle,
    )
    this.render()
    this.onChange(this.getSelection())
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
      x: clamp(clientX - box.left, 0, this.bounds.width),
      y: clamp(clientY - box.top, 0, this.bounds.height),
    }
  }

  private render(): void {
    if (!this.rect) {
      this.selection.classList.add('hidden')
      return
    }
    this.selection.classList.remove('hidden')
    this.selection.style.left = `${this.rect.x}px`
    this.selection.style.top = `${this.rect.y}px`
    this.selection.style.width = `${this.rect.width}px`
    this.selection.style.height = `${this.rect.height}px`
    const whole = this.rect.x < 0.5 && this.rect.y < 0.5 &&
      Math.abs(this.rect.width - this.bounds.width) < 0.5 &&
      Math.abs(this.rect.height - this.bounds.height) < 0.5
    this.selection.setAttribute('aria-label', whole ? '已选择整张图片' : '图片框选区域')
    this.label.textContent = whole ? '整张图片' : '框选区域'
  }
}

function isArrowKey(key: string): key is import('../shared/crop').ArrowKey {
  return key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
