import { describe, expect, it } from 'vitest'
import { MAX_IMAGE_FILE_BYTES } from '../src/shared/constants'
import { checkImageFile } from '../src/shared/image'

describe('image import validation', () => {
  it.each(['image/png', 'image/jpeg', 'image/webp'])('accepts %s', (type) => {
    expect(checkImageFile({ type, size: 1024 })).toEqual({ ok: true })
  })

  it('rejects unsupported files before decoding them', () => {
    expect(checkImageFile({ type: 'image/gif', size: 1024 })).toEqual({
      ok: false,
      reason: 'image-unsupported',
    })
  })

  it('rejects files over 20 MB before decoding them', () => {
    expect(checkImageFile({ type: 'image/png', size: MAX_IMAGE_FILE_BYTES + 1 })).toEqual({
      ok: false,
      reason: 'image-too-large',
    })
  })
})
