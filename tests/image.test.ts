import { describe, expect, it } from 'vitest'
import { MAX_IMAGE_EDGE, MAX_IMAGE_PIXELS } from '../src/shared/constants'
import {
  checkImageBytes,
  mapRectToBitmap,
  outputImageType,
  targetImageSize,
} from '../src/shared/image'

describe('image processing', () => {
  it('maps a displayed crop to source bitmap pixels', () => {
    expect(mapRectToBitmap(
      { x: 40, y: 20, width: 120, height: 80 },
      { width: 400, height: 200 },
      { width: 1000, height: 500 },
    )).toEqual({ x: 100, y: 50, width: 300, height: 200 })
  })

  it('rounds outward and clamps mapped pixels to the bitmap', () => {
    expect(mapRectToBitmap(
      { x: 199.7, y: 99.7, width: 0.3, height: 0.3 },
      { width: 200, height: 100 },
      { width: 1000, height: 500 },
    )).toEqual({ x: 998, y: 498, width: 2, height: 2 })
  })

  it('maps fractional CSS coordinates at a high device pixel ratio', () => {
    expect(mapRectToBitmap(
      { x: 10.25, y: 20.5, width: 40.5, height: 30.25 },
      { width: 320, height: 180 },
      { width: 800, height: 450 },
    )).toEqual({ x: 25, y: 51, width: 102, height: 76 })
  })

  it('rejects zero-sized rendered images', () => {
    expect(() => mapRectToBitmap(
      { x: 0, y: 0, width: 10, height: 10 },
      { width: 0, height: 100 },
      { width: 100, height: 100 },
    )).toThrow('图片显示尺寸无效')
  })

  it('never upscales and observes edge and pixel limits', () => {
    expect(targetImageSize(800, 600)).toEqual({ width: 800, height: 600 })
    expect(targetImageSize(8000, 4000)).toEqual({ width: MAX_IMAGE_EDGE, height: 2048 })

    const square = targetImageSize(5000, 5000)
    expect(square.width * square.height).toBeLessThanOrEqual(MAX_IMAGE_PIXELS)
    expect(square.width).toBeLessThan(5000)
    expect(square.height).toBeLessThan(5000)
  })

  it('keeps compact PNG output and falls back to WebP above the encoding threshold', () => {
    expect(outputImageType(7_500_000)).toBe('image/png')
    expect(outputImageType(7_500_001)).toBe('image/webp')
  })

  it.each([
    ['PNG', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png'],
    ['JPEG', [0xff, 0xd8, 0xff, 0xe0], 'image/jpeg'],
    ['WebP', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], 'image/webp'],
  ] as const)('recognizes %s bytes', (_label, bytes, type) => {
    expect(checkImageBytes(new Uint8Array(bytes))).toEqual({ ok: true, type })
  })

  it('rejects unsupported bytes even when a file claims a supported MIME type', () => {
    expect(checkImageBytes(new TextEncoder().encode('<svg></svg>'))).toEqual({
      ok: false,
      reason: 'image-unsupported',
    })
  })
})
