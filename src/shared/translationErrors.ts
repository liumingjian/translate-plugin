import type { TranslationErrorKind } from './types'

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])
const UNSUPPORTED_IMAGE_RE = /image|vision|multimodal|图片|视觉/i

export type ClassifiedHttpError = {
  kind: TranslationErrorKind
  retryable: boolean
}

export function classifyHttpError(
  status: number,
  detail: string,
  imageRequest: boolean,
): ClassifiedHttpError {
  if (status === 401 || status === 403) return { kind: 'auth', retryable: false }
  if (TRANSIENT_STATUS.has(status)) return { kind: 'unavailable', retryable: true }
  if (imageRequest && UNSUPPORTED_IMAGE_RE.test(detail)) {
    return { kind: 'image-unsupported', retryable: false }
  }
  return { kind: 'network', retryable: false }
}

export function classifyOutput(text: string, imageRequest: boolean): TranslationErrorKind | null {
  const output = text.trim()
  if (imageRequest && output === 'NO_TEXT') return 'no-text'
  if (output === '') return 'empty'
  return null
}

/** Holds back only a possible NO_TEXT sentinel so it never flashes as translated text. */
export class NoTextOutputBuffer {
  private pending: string | null = ''

  feed(chunk: string): string {
    if (this.pending === null) return chunk
    this.pending += chunk
    const candidate = this.pending.trimStart()
    if ('NO_TEXT'.startsWith(candidate) || /^NO_TEXT\s*$/.test(candidate)) return ''
    const output = this.pending
    this.pending = null
    return output
  }

  finish(): { text: string; noText: boolean } {
    const pending = this.pending
    this.pending = null
    return pending?.trim() === 'NO_TEXT'
      ? { text: '', noText: true }
      : { text: pending ?? '', noText: false }
  }
}
