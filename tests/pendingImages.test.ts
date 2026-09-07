import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PendingImages } from '../src/background/pendingImages'

describe('PendingImages', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('hands an image off exactly once', () => {
    const pending = new PendingImages(60_000)
    pending.add('token', 'data:image/png;base64,eA==')

    expect(pending.consume('token')).toBe('data:image/png;base64,eA==')
    expect(pending.consume('token')).toBeUndefined()
  })

  it('releases an image after its short lifetime', () => {
    const pending = new PendingImages(60_000)
    pending.add('token', 'data:image/png;base64,eA==')

    vi.advanceTimersByTime(60_000)

    expect(pending.consume('token')).toBeUndefined()
  })

  it('replacing a token cancels the old expiry timer', () => {
    const pending = new PendingImages(60_000)
    pending.add('token', 'first')
    vi.advanceTimersByTime(30_000)
    pending.add('token', 'second')
    vi.advanceTimersByTime(30_000)

    expect(pending.consume('token')).toBe('second')
  })
})
