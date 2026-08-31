import { MIN_IMAGE_SELECTION_SIZE } from './constants'

export type CropRect = { x: number; y: number; width: number; height: number }
export type Size = { width: number; height: number }
export type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
export type ArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'

export function normalizeRect(start: { x: number; y: number }, end: { x: number; y: number }): CropRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

export function clampRect(rect: CropRect, bounds: Size): CropRect {
  const width = clamp(rect.width, 0, bounds.width)
  const height = clamp(rect.height, 0, bounds.height)
  return {
    x: clamp(rect.x, 0, bounds.width - width),
    y: clamp(rect.y, 0, bounds.height - height),
    width,
    height,
  }
}

export function moveRect(rect: CropRect, dx: number, dy: number, bounds: Size): CropRect {
  return clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, bounds)
}

export function adjustRectWithKeyboard(
  rect: CropRect,
  key: ArrowKey,
  bounds: Size,
  step: number,
  handle?: ResizeHandle,
): CropRect {
  const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0
  const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0
  if (!handle) return moveRect(rect, dx, dy, bounds)
  return resizeRect(
    rect,
    handle,
    handle.includes('e') || handle.includes('w') ? dx : 0,
    handle.includes('n') || handle.includes('s') ? dy : 0,
    bounds,
  )
}

export function resizeRect(
  rect: CropRect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  bounds: Size,
  minimum = MIN_IMAGE_SELECTION_SIZE,
): CropRect {
  let left = rect.x
  let top = rect.y
  let right = rect.x + rect.width
  let bottom = rect.y + rect.height
  const minWidth = Math.min(minimum, bounds.width)
  const minHeight = Math.min(minimum, bounds.height)

  const horizontalMinimum = rect.width >= minWidth ? minWidth : 0
  const verticalMinimum = rect.height >= minHeight ? minHeight : 0
  if (handle.includes('w')) left = clamp(left + dx, 0, right - horizontalMinimum)
  if (handle.includes('e')) right = clamp(right + dx, left + horizontalMinimum, bounds.width)
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - verticalMinimum)
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + verticalMinimum, bounds.height)

  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function scaleRect(rect: CropRect, from: Size, to: Size): CropRect {
  if (from.width <= 0 || from.height <= 0) return clampRect(rect, to)
  return clampRect({
    x: rect.x * to.width / from.width,
    y: rect.y * to.height / from.height,
    width: rect.width * to.width / from.width,
    height: rect.height * to.height / from.height,
  }, to)
}

export function validCrop(rect: CropRect | null): rect is CropRect {
  return !!rect && rect.width >= MIN_IMAGE_SELECTION_SIZE && rect.height >= MIN_IMAGE_SELECTION_SIZE
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
