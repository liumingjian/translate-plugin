export type ClipboardPermissionApi = Pick<
  typeof chrome.permissions,
  'contains' | 'request' | 'remove'
>

export type ClipboardReader = Pick<Clipboard, 'read'>

const CLIPBOARD_READ_PERMISSION: chrome.permissions.Permissions = {
  permissions: ['clipboardRead'],
}

export function imageFileFromTransfer(transfer: Pick<DataTransfer, 'files'>): File | null {
  return Array.from(transfer.files).find((file) => file.type.startsWith('image/')) ?? null
}

export async function readClipboardImage(
  clipboard: ClipboardReader = navigator.clipboard,
): Promise<File | null> {
  const items = await clipboard.read()
  for (const item of items) {
    const imageType = item.types.find((type) => type.startsWith('image/'))
    if (!imageType) continue
    const blob = await item.getType(imageType)
    return new File([blob], '系统剪贴板图片', { type: imageType })
  }
  return null
}

export function containsClipboardReadPermission(
  permissions: ClipboardPermissionApi = chrome.permissions,
): Promise<boolean> {
  return permissions.contains(CLIPBOARD_READ_PERMISSION)
}

export function requestClipboardReadPermission(
  permissions: ClipboardPermissionApi = chrome.permissions,
): Promise<boolean> {
  return permissions.request(CLIPBOARD_READ_PERMISSION)
}

export function removeClipboardReadPermission(
  permissions: ClipboardPermissionApi = chrome.permissions,
): Promise<boolean> {
  return permissions.remove(CLIPBOARD_READ_PERMISSION)
}
