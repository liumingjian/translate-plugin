import {
  adjustRectWithKeyboard,
  clampRect,
  moveRect,
  normalizeRect,
  resizeRect,
  scaleRect,
} from './crop'
import type { ArrowKey, CropRect, ResizeHandle, Size } from './crop'

export type Point = { x: number; y: number }
export type CropInteractionTarget = 'create' | 'move' | ResizeHandle

type ActiveInteraction =
  | { kind: 'create'; start: Point }
  | { kind: 'move'; start: Point; rect: CropRect }
  | { kind: 'resize'; start: Point; rect: CropRect; handle: ResizeHandle }

export const CROP_HANDLES: ResizeHandle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']

export const CROP_HANDLE_LABELS: Record<ResizeHandle, string> = {
  n: '调整上边界',
  ne: '调整右上角',
  e: '调整右边界',
  se: '调整右下角',
  s: '调整下边界',
  sw: '调整左下角',
  w: '调整左边界',
  nw: '调整左上角',
}

export class CropInteractionController {
  private rect: CropRect | null = null
  private bounds: Size = { width: 0, height: 0 }
  private active: ActiveInteraction | null = null

  constructor(private readonly onChange: (rect: CropRect | null) => void = () => {}) {}

  getRect(): CropRect | null {
    return this.rect ? { ...this.rect } : null
  }

  getBounds(): Size {
    return { ...this.bounds }
  }

  setBounds(bounds: Size, scaleSelection = false): void {
    const next = { width: Math.max(0, bounds.width), height: Math.max(0, bounds.height) }
    if (this.rect) {
      this.rect = scaleSelection && this.bounds.width > 0 && this.bounds.height > 0
        ? scaleRect(this.rect, this.bounds, next)
        : clampRect(this.rect, next)
    }
    this.bounds = next
    this.changed()
  }

  setRect(rect: CropRect | null): void {
    this.active = null
    this.rect = rect ? clampRect(rect, this.bounds) : null
    this.changed()
  }

  selectWholeBounds(inset = 0): void {
    const safeInset = Math.min(inset, this.bounds.width / 2, this.bounds.height / 2)
    this.setRect({
      x: safeInset,
      y: safeInset,
      width: Math.max(0, this.bounds.width - safeInset * 2),
      height: Math.max(0, this.bounds.height - safeInset * 2),
    })
  }

  begin(point: Point, target: CropInteractionTarget): void {
    const start = this.clampPoint(point)
    if (target === 'create' || !this.rect) {
      this.active = { kind: 'create', start }
      this.rect = { x: start.x, y: start.y, width: 0, height: 0 }
    } else if (target === 'move') {
      this.active = { kind: 'move', start, rect: { ...this.rect } }
    } else {
      this.active = { kind: 'resize', start, rect: { ...this.rect }, handle: target }
    }
    this.changed()
  }

  update(point: Point): void {
    if (!this.active) return
    const current = this.clampPoint(point)
    const dx = current.x - this.active.start.x
    const dy = current.y - this.active.start.y
    switch (this.active.kind) {
      case 'create':
        this.rect = normalizeRect(this.active.start, current)
        break
      case 'move':
        this.rect = moveRect(this.active.rect, dx, dy, this.bounds)
        break
      case 'resize':
        this.rect = resizeRect(this.active.rect, this.active.handle, dx, dy, this.bounds)
        break
    }
    this.changed()
  }

  end(): void {
    this.active = null
  }

  adjust(key: ArrowKey, step: number, handle?: ResizeHandle): void {
    if (!this.rect) return
    this.rect = adjustRectWithKeyboard(this.rect, key, this.bounds, step, handle)
    this.changed()
  }

  contains(point: Point): boolean {
    if (!this.rect) return false
    const current = this.clampPoint(point)
    return current.x >= this.rect.x && current.y >= this.rect.y &&
      current.x <= this.rect.x + this.rect.width &&
      current.y <= this.rect.y + this.rect.height
  }

  clampPoint(point: Point): Point {
    return {
      x: clamp(point.x, 0, this.bounds.width),
      y: clamp(point.y, 0, this.bounds.height),
    }
  }

  private changed(): void {
    this.onChange(this.getRect())
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
