export type Rect = { left: number; top: number; right: number; bottom: number }
export type Size = { width: number; height: number }
export type Viewport = { width: number; height: number }

export type Placement = {
  left: number
  top: number
  /** 是否发生了翻转，供调用方决定动画方向。 */
  flippedX: boolean
  flippedY: boolean
}

export type AnchorOptions = {
  anchor: Rect
  size: Size
  viewport: Viewport
  /** 元素与锚点之间的间距。 */
  gap?: number
  /** 元素与视口边缘之间的最小留白。 */
  margin?: number
}

export type ConstrainOptions = {
  left: number
  top: number
  size: Size
  viewport: Viewport
  margin?: number
}

/**
 * 把一个浮层放到锚点的右下方；贴到视口边缘时翻转到左侧/上方。
 * 返回的是视口坐标（fixed 定位可直接用）。
 */
export function anchorBottomRight({
  anchor,
  size,
  viewport,
  gap = 6,
  margin = 8,
}: AnchorOptions): Placement {
  let left = anchor.right + gap
  let flippedX = false
  if (left + size.width > viewport.width - margin) {
    left = anchor.left - size.width - gap
    flippedX = true
  }

  let top = anchor.bottom + gap
  let flippedY = false
  if (top + size.height > viewport.height - margin) {
    top = anchor.top - size.height - gap
    flippedY = true
  }

  return {
    left: clamp(left, margin, Math.max(margin, viewport.width - size.width - margin)),
    top: clamp(top, margin, Math.max(margin, viewport.height - size.height - margin)),
    flippedX,
    flippedY,
  }
}

/** 把一个 fixed 元素的左上角约束在可见视口内。 */
export function constrainToViewport({
  left,
  top,
  size,
  viewport,
  margin = 8,
}: ConstrainOptions): { left: number; top: number } {
  return {
    left: clamp(left, margin, Math.max(margin, viewport.width - size.width - margin)),
    top: clamp(top, margin, Math.max(margin, viewport.height - size.height - margin)),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
