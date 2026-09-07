import { describe, expect, it, vi } from 'vitest'
import {
  containsClipboardReadPermission,
  imageFileFromTransfer,
  readClipboardImage,
  removeClipboardReadPermission,
  requestClipboardReadPermission,
  type ClipboardPermissionApi,
  type ClipboardReader,
} from '../src/workspace/imageImport'

describe('image acquisition', () => {
  it('takes the first image from trusted transfer data without reading the clipboard', () => {
    const text = new File(['notes'], 'notes.txt', { type: 'text/plain' })
    const image = new File(['png'], 'screen.png', { type: 'image/png' })

    expect(imageFileFromTransfer({ files: [text, image] as unknown as FileList })).toBe(image)
  })

  it('ignores transfer data without an image', () => {
    const text = new File(['notes'], 'notes.txt', { type: 'text/plain' })
    expect(imageFileFromTransfer({ files: [text] as unknown as FileList })).toBeNull()
  })

  it('reads an image from the async clipboard only when called explicitly', async () => {
    const getType = vi.fn().mockResolvedValue(new Blob(['webp'], { type: 'image/webp' }))
    const read = vi.fn().mockResolvedValue([
      { types: ['text/plain'] },
      { types: ['text/plain', 'image/webp'], getType },
    ])

    const file = await readClipboardImage({ read } as unknown as ClipboardReader)

    expect(read).toHaveBeenCalledOnce()
    expect(getType).toHaveBeenCalledWith('image/webp')
    expect(file).toMatchObject({ name: '系统剪贴板图片', type: 'image/webp', size: 4 })
  })

  it('treats a clipboard without images as an ordinary empty source', async () => {
    const read = vi.fn().mockResolvedValue([{ types: ['text/plain'] }])
    await expect(readClipboardImage({ read } as unknown as ClipboardReader)).resolves.toBeNull()
  })
})

describe('optional clipboard permission', () => {
  it('uses the optional clipboardRead permission for contains, request and removal', async () => {
    const permissions = {
      contains: vi.fn().mockResolvedValue(false),
      request: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockResolvedValue(true),
    } as ClipboardPermissionApi

    await expect(containsClipboardReadPermission(permissions)).resolves.toBe(false)
    await expect(requestClipboardReadPermission(permissions)).resolves.toBe(true)
    await expect(removeClipboardReadPermission(permissions)).resolves.toBe(true)

    const expected = { permissions: ['clipboardRead'] }
    expect(permissions.contains).toHaveBeenCalledWith(expected)
    expect(permissions.request).toHaveBeenCalledWith(expected)
    expect(permissions.remove).toHaveBeenCalledWith(expected)
  })

  it('passes a refused optional permission decision back to the workspace', async () => {
    const permissions = {
      contains: vi.fn(),
      request: vi.fn().mockResolvedValue(false),
      remove: vi.fn(),
    } as ClipboardPermissionApi

    await expect(requestClipboardReadPermission(permissions)).resolves.toBe(false)
  })
})
