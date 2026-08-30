import {
  MAX_IMAGE_EDGE,
  MAX_IMAGE_FILE_BYTES,
  MAX_IMAGE_PIXELS,
  MIN_IMAGE_SELECTION_SIZE,
} from './constants'

export type CropRect = { x: number; y: number; width: number; height: number }
export type Size = { width: number; height: number }

const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export function normalizeRect(start: { x: number; y: number }, end: { x: number; y: number }): CropRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

export function clampRect(rect: CropRect, bounds: Size): CropRect {
  const x = clamp(rect.x, 0, bounds.width)
  const y = clamp(rect.y, 0, bounds.height)
  return {
    x,
    y,
    width: clamp(rect.width, 0, bounds.width - x),
    height: clamp(rect.height, 0, bounds.height - y),
  }
}

export function validCrop(rect: CropRect | null): rect is CropRect {
  return !!rect && rect.width >= MIN_IMAGE_SELECTION_SIZE && rect.height >= MIN_IMAGE_SELECTION_SIZE
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

export async function cropImageDataUrl(
  sourceDataUrl: string,
  rect: CropRect,
  rendered: Size,
): Promise<string> {
  const image = await loadImage(sourceDataUrl)
  const sourceX = Math.round((rect.x / rendered.width) * image.naturalWidth)
  const sourceY = Math.round((rect.y / rendered.height) * image.naturalHeight)
  const sourceWidth = Math.max(1, Math.round((rect.width / rendered.width) * image.naturalWidth))
  const sourceHeight = Math.max(1, Math.round((rect.height / rendered.height) * image.naturalHeight))
  const target = targetImageSize(sourceWidth, sourceHeight)
  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建图片画布')
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    target.width,
    target.height,
  )
  const png = canvas.toDataURL('image/png')
  return png.length <= 10_000_000 ? png : canvas.toDataURL('image/webp', 0.92)
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
