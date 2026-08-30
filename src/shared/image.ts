import {
  MAX_IMAGE_EDGE,
  MAX_IMAGE_FILE_BYTES,
  MAX_IMAGE_PIXELS,
} from './constants'
import { clampRect } from './crop'
import type { CropRect, Size } from './crop'

export type { CropRect, Size } from './crop'

const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const PNG_OUTPUT_THRESHOLD_BYTES = 7_500_000

export function outputImageType(pngBytes: number): 'image/png' | 'image/webp' {
  return pngBytes <= PNG_OUTPUT_THRESHOLD_BYTES ? 'image/png' : 'image/webp'
}

export function targetImageSize(width: number, height: number): Size {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 }
  const edgeScale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height))
  const pixelScale = Math.min(1, Math.sqrt(MAX_IMAGE_PIXELS / (width * height)))
  const scale = Math.min(edgeScale, pixelScale)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export function checkImageFile(file: Pick<File, 'size' | 'type'>):
  | { ok: true }
  | { ok: false; reason: 'image-too-large' | 'image-unsupported' } {
  if (file.size > MAX_IMAGE_FILE_BYTES) return { ok: false, reason: 'image-too-large' }
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) return { ok: false, reason: 'image-unsupported' }
  return { ok: true }
}

export function checkImageBytes(bytes: Uint8Array):
  | { ok: true; type: 'image/png' | 'image/jpeg' | 'image/webp' }
  | { ok: false; reason: 'image-unsupported' } {
  if (hasBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ok: true, type: 'image/png' }
  }
  if (hasBytes(bytes, [0xff, 0xd8, 0xff])) return { ok: true, type: 'image/jpeg' }
  if (
    hasBytes(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    hasBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return { ok: true, type: 'image/webp' }
  }
  return { ok: false, reason: 'image-unsupported' }
}

export function mapRectToBitmap(rect: CropRect, rendered: Size, bitmap: Size): CropRect {
  if (rendered.width <= 0 || rendered.height <= 0) throw new Error('图片显示尺寸无效')
  const constrained = clampRect(rect, rendered)
  const left = clamp(Math.floor(constrained.x / rendered.width * bitmap.width), 0, bitmap.width)
  const top = clamp(Math.floor(constrained.y / rendered.height * bitmap.height), 0, bitmap.height)
  const right = clamp(
    Math.ceil((constrained.x + constrained.width) / rendered.width * bitmap.width),
    left,
    bitmap.width,
  )
  const bottom = clamp(
    Math.ceil((constrained.y + constrained.height) / rendered.height * bitmap.height),
    top,
    bitmap.height,
  )
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export async function cropImageDataUrl(
  sourceDataUrl: string,
  rect: CropRect,
  rendered: Size,
): Promise<string> {
  const image = await loadImage(sourceDataUrl)
  const source = mapRectToBitmap(rect, rendered, {
    width: image.naturalWidth,
    height: image.naturalHeight,
  })
  if (source.width < 1 || source.height < 1) throw new Error('图片框选区域无效')
  const target = targetImageSize(source.width, source.height)
  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建图片画布')
  context.drawImage(
    image,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    target.width,
    target.height,
  )
  const png = await canvasToBlob(canvas, 'image/png')
  const encoded = outputImageType(png.size) === 'image/png'
    ? png
    : await canvasToBlob(canvas, 'image/webp', 0.92)
  return blobToDataUrl(encoded)
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片无法解码'))
    image.src = source
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function hasBytes(bytes: Uint8Array, expected: readonly number[], offset = 0): boolean {
  return expected.every((value, index) => bytes[offset + index] === value)
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('图片编码失败')),
      type,
      quality,
    )
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('图片编码失败'))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
