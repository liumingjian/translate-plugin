import { describe, expect, it } from 'vitest'
import { anchorBottomRight, constrainToViewport } from '../src/shared/position'

const viewport = { width: 1000, height: 800 }
const size = { width: 100, height: 50 }

describe('anchorBottomRight', () => {
  it('默认放在锚点右下方', () => {
    const placement = anchorBottomRight({
      anchor: { left: 100, top: 100, right: 200, bottom: 120 },
      size,
      viewport,
    })
    expect(placement).toMatchObject({ left: 206, top: 126, flippedX: false, flippedY: false })
  })

  it('贴右边缘时翻到锚点左侧', () => {
    const placement = anchorBottomRight({
      anchor: { left: 900, top: 100, right: 980, bottom: 120 },
      size,
      viewport,
    })
    expect(placement.flippedX).toBe(true)
    expect(placement.left).toBe(794)
  })

  it('贴下边缘时翻到锚点上方', () => {
    const placement = anchorBottomRight({
      anchor: { left: 100, top: 700, right: 200, bottom: 780 },
      size,
      viewport,
    })
    expect(placement.flippedY).toBe(true)
    expect(placement.top).toBe(644)
  })

  it('右下角同时翻转两个方向', () => {
    const placement = anchorBottomRight({
      anchor: { left: 900, top: 700, right: 980, bottom: 780 },
      size,
      viewport,
    })
    expect(placement).toMatchObject({ flippedX: true, flippedY: true })
  })

  it('翻转后仍越界时夹回视口内', () => {
    const placement = anchorBottomRight({
      anchor: { left: 0, top: 0, right: 990, bottom: 795 },
      size,
      viewport,
    })
    expect(placement.left).toBeGreaterThanOrEqual(8)
    expect(placement.left + size.width).toBeLessThanOrEqual(viewport.width - 8 + 0.001)
    expect(placement.top).toBeGreaterThanOrEqual(8)
  })

  it('浮层比视口还大时不会算出负坐标', () => {
    const placement = anchorBottomRight({
      anchor: { left: 10, top: 10, right: 20, bottom: 20 },
      size: { width: 2000, height: 2000 },
      viewport,
    })
    expect(placement.left).toBe(8)
    expect(placement.top).toBe(8)
  })
})

describe('constrainToViewport', () => {
  it('keeps a dragged screenshot card inside every viewport edge', () => {
    expect(constrainToViewport({
      left: 950,
      top: -40,
      size: { width: 380, height: 460 },
      viewport,
    })).toEqual({ left: 612, top: 8 })
  })

  it('uses the viewport margin when the screenshot card is larger than the viewport', () => {
    expect(constrainToViewport({
      left: -100,
      top: 500,
      size: { width: 600, height: 600 },
      viewport: { width: 400, height: 300 },
    })).toEqual({ left: 8, top: 8 })
  })
})
