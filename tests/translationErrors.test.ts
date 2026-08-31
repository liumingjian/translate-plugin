import { describe, expect, it } from 'vitest'
import {
  NoTextOutputBuffer,
  classifyHttpError,
  classifyOutput,
} from '../src/shared/translationErrors'

describe('screenshot translation error classification', () => {
  it.each([401, 403])('classifies HTTP %s as authentication failure', (status) => {
    expect(classifyHttpError(status, 'invalid key', true)).toEqual({
      kind: 'auth',
      retryable: false,
    })
  })

  it.each([408, 425, 429, 500, 502, 503, 504])(
    'classifies transient HTTP %s as unavailable and retryable',
    (status) => {
      expect(classifyHttpError(status, 'try later', true)).toEqual({
        kind: 'unavailable',
        retryable: true,
      })
    },
  )

  it.each([
    'This model does not support image input',
    'vision is unavailable for this model',
    'multimodal content is not supported',
    '该模型不支持图片',
  ])('detects unsupported screenshot models from service detail', (detail) => {
    expect(classifyHttpError(400, detail, true)).toEqual({
      kind: 'image-unsupported',
      retryable: false,
    })
  })

  it('does not reinterpret the same detail for text requests', () => {
    expect(classifyHttpError(400, 'image field is invalid', false)).toEqual({
      kind: 'network',
      retryable: false,
    })
  })

  it('classifies other client and transport failures as network errors', () => {
    expect(classifyHttpError(400, 'bad request', true)).toEqual({
      kind: 'network',
      retryable: false,
    })
  })

  it('distinguishes empty output and the screenshot no-text sentinel', () => {
    expect(classifyOutput('', true)).toBe('empty')
    expect(classifyOutput('  NO_TEXT\n', true)).toBe('no-text')
    expect(classifyOutput('NO_TEXT', false)).toBeNull()
    expect(classifyOutput('translated text', true)).toBeNull()
  })
})

describe('NO_TEXT stream buffering', () => {
  it('withholds a sentinel split across arbitrary SSE deltas', () => {
    const buffer = new NoTextOutputBuffer()
    expect(['', '\n', 'NO', '_', 'TEXT', '\n'].map((chunk) => buffer.feed(chunk)).join('')).toBe(
      '',
    )
    expect(buffer.finish()).toEqual({ text: '', noText: true })
  })

  it('passes a normal language header through without waiting for stream completion', () => {
    const buffer = new NoTextOutputBuffer()
    expect(buffer.feed('EN')).toBe('EN')
    expect(buffer.feed('>ZH\ntranslated')).toBe('>ZH\ntranslated')
    expect(buffer.finish()).toEqual({ text: '', noText: false })
  })

  it('does not swallow output that merely begins like the sentinel', () => {
    const buffer = new NoTextOutputBuffer()
    expect(buffer.feed('NO')).toBe('')
    expect(buffer.feed(' translation')).toBe('NO translation')
    expect(buffer.finish()).toEqual({ text: '', noText: false })
  })
})
