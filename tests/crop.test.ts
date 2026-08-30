import { describe, expect, it } from 'vitest'
import {
  clampRect,
  moveRect,
  normalizeRect,
  resizeRect,
  scaleRect,
} from '../src/shared/crop'

describe('crop geometry', () => {
  it('normalizes a rectangle drawn in any direction', () => {
    expect(normalizeRect({ x: 80, y: 60 }, { x: 20, y: 10 })).toEqual({
      x: 20,
      y: 10,
      width: 60,
      height: 50,
    })
  })

  it('keeps a rectangle inside its bounds without changing its size', () => {
    expect(clampRect({ x: 90, y: -10, width: 30, height: 50 }, { width: 100, height: 80 })).toEqual({
      x: 70,
      y: 0,
      width: 30,
      height: 50,
    })
  })

  it('moves a rectangle until it reaches an edge', () => {
    expect(moveRect({ x: 20, y: 10, width: 40, height: 30 }, 100, 100, { width: 100, height: 80 })).toEqual({
      x: 60,
      y: 50,
      width: 40,
      height: 30,
    })
  })

  it('resizes from all eight handles while respecting bounds and minimum size', () => {
    const rect = { x: 20, y: 10, width: 40, height: 30 }
    const bounds = { width: 100, height: 80 }

    expect(resizeRect(rect, 'nw', -30, -20, bounds)).toEqual({ x: 0, y: 0, width: 60, height: 40 })
    expect(resizeRect(rect, 'n', 0, -20, bounds)).toEqual({ x: 20, y: 0, width: 40, height: 40 })
    expect(resizeRect(rect, 'ne', 100, -20, bounds)).toEqual({ x: 20, y: 0, width: 80, height: 40 })
    expect(resizeRect(rect, 'e', 100, 0, bounds)).toEqual({ x: 20, y: 10, width: 80, height: 30 })
    expect(resizeRect(rect, 'se', 100, 100, bounds)).toEqual({ x: 20, y: 10, width: 80, height: 70 })
    expect(resizeRect(rect, 's', 0, 100, bounds)).toEqual({ x: 20, y: 10, width: 40, height: 70 })
    expect(resizeRect(rect, 'sw', -30, 100, bounds)).toEqual({ x: 0, y: 10, width: 60, height: 70 })
    expect(resizeRect(rect, 'w', -30, 0, bounds)).toEqual({ x: 0, y: 10, width: 60, height: 30 })
    expect(resizeRect(rect, 'e', -100, 0, bounds)).toEqual({ x: 20, y: 10, width: 16, height: 30 })
  })

  it('preserves the selected image region when display bounds change', () => {
    expect(scaleRect(
      { x: 50, y: 25, width: 100, height: 50 },
      { width: 200, height: 100 },
      { width: 400, height: 300 },
    )).toEqual({ x: 100, y: 75, width: 200, height: 150 })
  })
})
