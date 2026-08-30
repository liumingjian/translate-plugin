import { validCrop } from '../shared/crop'
import { checkImageBytes, checkImageFile, cropImageDataUrl } from '../shared/image'
import { langName } from '../shared/lang'
import { getSettings, saveSettings } from '../shared/settings'
import { TranslationClient } from '../shared/translationClient'
import type { RuntimeRequest, TranslateEvent, TranslationErrorKind } from '../shared/types'
import { ImageSurface } from './imageSurface'
import {
  containsClipboardReadPermission,
  imageFileFromTransfer,
  readClipboardImage,
  removeClipboardReadPermission,
  requestClipboardReadPermission,
} from './imageImport'

const ERROR_MESSAGES: Record<TranslationErrorKind, string> = {
  'no-api-key': '还没有配置 api-key',
  auth: '鉴权失败，请检查 api-key',
  network: '请求失败，请稍后重试',
  unavailable: '翻译服务暂时不可用，请稍后重试',
  empty: '截图模型没有返回译文',
  'too-long': '内容过长',
  'image-too-small': '图片太小',
  'image-too-large': '图片超过 20 MB',
  'image-unsupported': '仅支持 PNG、JPEG 和 WebP 图片，请检查截图模型配置',
  'no-text': '未识别到可翻译文字',
}

const chooseButton = byId<HTMLButtonElement>('choose')
const reimportButton = byId<HTMLButtonElement>('reimport')
const clearButton = byId<HTMLButtonElement>('clear')
const translateButton = byId<HTMLButtonElement>('translate')
const fileInput = byId<HTMLInputElement>('fileInput')
const emptyState = byId<HTMLDivElement>('emptyState')
const imageStage = byId<HTMLDivElement>('imageStage')
const sourceImage = byId<HTMLImageElement>('sourceImage')
const imageFrame = bySelector<HTMLDivElement>('.image-frame')
const cropSelection = byId<HTMLDivElement>('cropSelection')
const selectionLabel = byId<HTMLSpanElement>('selectionLabel')
const newSelectionButton = byId<HTMLButtonElement>('newSelection')
const sourceMeta = byId<HTMLSpanElement>('sourceMeta')
const imageStatus = byId<HTMLParagraphElement>('imageStatus')
const language = byId<HTMLSpanElement>('language')
const result = byId<HTMLDivElement>('result')
const resultError = byId<HTMLParagraphElement>('resultError')
const copyButton = byId<HTMLButtonElement>('copy')
const openOptionsButton = byId<HTMLButtonElement>('openOptions')
const privacyDialog = byId<HTMLDialogElement>('privacyDialog')
const privacyAccept = byId<HTMLButtonElement>('privacyAccept')
const privacyCancel = byId<HTMLButtonElement>('privacyCancel')
const autoReadClipboard = byId<HTMLInputElement>('autoReadClipboard')

const client = new TranslationClient()
let sourceDataUrl: string | null = null
let translatedText = ''
let privacyAccepted = false
let translating = false
let taskRevision = 0
let sourceRevision = 0
let lastErrorKind: TranslationErrorKind | null = null

const imageSurface = new ImageSurface(
  imageFrame,
  sourceImage,
  cropSelection,
  selectionLabel,
  newSelectionButton,
  handleSelectionChange,
  () => void startTranslation(),
)

void initialize()

async function initialize(): Promise<void> {
  const settings = await getSettings()
  privacyAccepted = settings.imagePrivacyAccepted
  if (!settings.imagePrivacyAccepted) privacyDialog.showModal()

  const token = new URLSearchParams(location.search).get('capture')
  if (token) {
    const revision = ++sourceRevision
    const response = await sendMessage<{ ok: boolean; imageDataUrl?: string }>({
      type: 'consume-pending-image',
      token,
    })
    history.replaceState(null, '', location.pathname)
    if (revision === sourceRevision) {
      if (!response.ok || !response.imageDataUrl) {
        imageStatus.textContent = '截图已失效，请重新发起截图翻译'
      } else {
        await loadSource(response.imageDataUrl, '当前页面截图', revision)
      }
    }
  }

  const hasPermission = await containsClipboardReadPermission()
  autoReadClipboard.checked = settings.autoReadClipboard && hasPermission
  if (settings.autoReadClipboard && !hasPermission) await saveAutoReadPreference(false)
  if (!token && autoReadClipboard.checked) await importClipboardImage()
}

privacyAccept.addEventListener('click', () => {
  void (async () => {
    const current = await getSettings()
    await saveSettings({ ...current, imagePrivacyAccepted: true })
    privacyAccepted = true
    privacyDialog.close()
  })()
})

privacyCancel.addEventListener('click', () => privacyDialog.close())
chooseButton.addEventListener('click', openFilePicker)
reimportButton.addEventListener('click', openFilePicker)
clearButton.addEventListener('click', clearWorkspace)
translateButton.addEventListener('click', () => void startTranslation())
openOptionsButton.addEventListener('click', () => {
  const type = lastErrorKind === 'image-unsupported'
    ? 'open-image-model-settings'
    : 'open-options'
  void sendMessage({ type })
})
copyButton.addEventListener('click', () => void copyTranslation())
autoReadClipboard.addEventListener('change', () => void setAutoReadClipboard(autoReadClipboard.checked))

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  if (!file) return
  void importFile(file)
})

document.addEventListener('dragover', (event) => {
  if (!event.dataTransfer) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
  document.body.classList.add('drag-active')
})

document.addEventListener('dragleave', (event) => {
  if (event.relatedTarget === null) document.body.classList.remove('drag-active')
})

document.addEventListener('drop', (event) => {
  document.body.classList.remove('drag-active')
  if (!event.dataTransfer) return
  event.preventDefault()
  const file = imageFileFromTransfer(event.dataTransfer)
  if (file) void importFile(file)
})

document.addEventListener('paste', (event) => {
  if (!event.clipboardData) return
  const file = imageFileFromTransfer(event.clipboardData)
  if (file) void importFile(file, '系统剪贴板图片')
})

chrome.permissions.onRemoved.addListener((permissions) => {
  if (!permissions.permissions?.includes('clipboardRead')) return
  void disableRevokedClipboardRead()
})

window.addEventListener('focus', () => void reconcileClipboardReadPermission())

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.repeat || privacyDialog.open || !sourceDataUrl) return
  if (event.target instanceof HTMLButtonElement) return
  event.preventDefault()
  void startTranslation()
})

window.addEventListener('pagehide', releaseWorkspace, { once: true })

function openFilePicker(): void {
  fileInput.value = ''
  fileInput.click()
}

async function importFile(file: File, label = file.name): Promise<void> {
  const check = checkImageFile(file)
  if (!check.ok) {
    imageStatus.textContent = ERROR_MESSAGES[check.reason]
    fileInput.value = ''
    return
  }
  const revision = ++sourceRevision
  try {
    const buffer = await file.arrayBuffer()
    if (revision !== sourceRevision) return
    const bytesCheck = checkImageBytes(new Uint8Array(buffer))
    if (!bytesCheck.ok) {
      imageStatus.textContent = '仅支持 PNG、JPEG 和 WebP 图片'
      fileInput.value = ''
      return
    }
    const dataUrl = await readDataUrl(new Blob([buffer], { type: bytesCheck.type }))
    if (revision !== sourceRevision) return
    await loadSource(dataUrl, label, revision)
  } catch {
    if (revision !== sourceRevision) return
    imageStatus.textContent = '无法读取这张图片'
    fileInput.value = ''
  }
}

async function setAutoReadClipboard(enabled: boolean): Promise<void> {
  if (!enabled) {
    await saveAutoReadPreference(false)
    await removeClipboardReadPermission()
    return
  }

  const granted = await requestClipboardReadPermission()
  autoReadClipboard.checked = granted
  await saveAutoReadPreference(granted)
  if (!granted) {
    imageStatus.textContent = '未授予剪贴板读取权限，仍可拖放或手动粘贴图片'
    return
  }
  imageStatus.textContent = ''
  await importClipboardImage()
}

async function importClipboardImage(): Promise<void> {
  try {
    const file = await readClipboardImage()
    if (file) await importFile(file)
  } catch {
    const hasPermission = await containsClipboardReadPermission()
    if (!hasPermission) {
      autoReadClipboard.checked = false
      await saveAutoReadPreference(false)
      imageStatus.textContent = '自动读取已关闭，仍可拖放或手动粘贴图片'
    } else {
      imageStatus.textContent = '暂时无法读取系统剪贴板，可按 Ctrl/Cmd+V 手动粘贴'
    }
  }
}

async function saveAutoReadPreference(enabled: boolean): Promise<void> {
  const current = await getSettings()
  if (current.autoReadClipboard === enabled) return
  await saveSettings({ ...current, autoReadClipboard: enabled })
}

async function reconcileClipboardReadPermission(): Promise<void> {
  if (!autoReadClipboard.checked) return
  if (!(await containsClipboardReadPermission())) await disableRevokedClipboardRead()
}

async function disableRevokedClipboardRead(): Promise<void> {
  autoReadClipboard.checked = false
  await saveAutoReadPreference(false)
  imageStatus.textContent = '自动读取已关闭，仍可拖放或手动粘贴图片'
}

async function loadSource(dataUrl: string, label: string, source: number): Promise<void> {
  const revision = replaceTask()
  await decodeImage(dataUrl)
  if (revision !== taskRevision || source !== sourceRevision) return
  sourceDataUrl = dataUrl
  translatedText = ''
  sourceImage.src = dataUrl
  sourceMeta.textContent = label
  imageStatus.textContent = ''
  emptyState.classList.add('hidden')
  imageStage.classList.remove('hidden')
  await nextFrame()
  imageSurface.resetToWholeImage()
  reimportButton.disabled = false
  clearButton.disabled = false
  newSelectionButton.disabled = false
  resetResult('已选择整张图片，按 Enter 开始翻译')
}

async function startTranslation(): Promise<void> {
  const selection = imageSurface.getSelection()
  if (!sourceDataUrl || translating) return
  if (!validCrop(selection)) {
    imageStatus.textContent = '框选区域太小，请重新框选'
    return
  }
  if (!privacyAccepted) {
    privacyDialog.showModal()
    return
  }
  const revision = ++taskRevision
  translating = true
  translatedText = ''
  language.textContent = '自动 → 自动'
  result.textContent = ''
  result.className = 'result loading'
  resultError.classList.add('hidden')
  resultError.textContent = ''
  lastErrorKind = null
  copyButton.disabled = true
  openOptionsButton.classList.add('hidden')
  translateButton.disabled = true
  translateButton.textContent = '翻译中…'

  let croppedDataUrl: string
  try {
    croppedDataUrl = await cropImageDataUrl(sourceDataUrl, selection, imageSurface.getRenderedSize())
  } catch {
    if (revision !== taskRevision) return
    translating = false
    showError('image-unsupported', '无法处理框选区域')
    return
  }
  if (revision !== taskRevision) return

  client.start(
    { type: 'translate-image', imageDataUrl: croppedDataUrl },
    {
      onEvent: (event) => {
        if (revision === taskRevision) handleEvent(event)
      },
      onDisconnect: () => {
        if (revision === taskRevision) showError('network', '连接中断')
      },
    },
  )
}

function handleEvent(event: TranslateEvent): void {
  switch (event.type) {
    case 'lang':
      language.textContent = `${langName(event.source)} → ${langName(event.target)}`
      break
    case 'delta':
      result.classList.remove('loading', 'muted')
      translatedText += event.text
      result.textContent = translatedText
      break
    case 'done':
      client.finish()
      finishTranslation()
      break
    case 'error':
      client.finish()
      showError(event.kind, event.detail)
      break
  }
}

function finishTranslation(): void {
  translating = false
  result.classList.remove('loading', 'muted', 'error')
  resultError.classList.add('hidden')
  translateButton.disabled = false
  translateButton.textContent = '重新翻译选中区域'
  copyButton.disabled = translatedText === ''
}

function showError(kind: TranslationErrorKind, detail?: string): void {
  translating = false
  lastErrorKind = kind
  result.classList.remove('loading', 'error')
  result.classList.toggle('muted', translatedText === '')
  resultError.textContent = detail ? `${ERROR_MESSAGES[kind]}：${detail}` : ERROR_MESSAGES[kind]
  resultError.classList.remove('hidden')
  const reselect = kind === 'no-text'
  translateButton.disabled = reselect
  translateButton.textContent = reselect ? '请重新框选' : '重试翻译'
  copyButton.disabled = translatedText === ''
  if (reselect) imageStatus.textContent = '请重新框选包含文字的区域'
  openOptionsButton.classList.toggle('hidden', kind !== 'no-api-key' && kind !== 'auth' && kind !== 'image-unsupported')
  openOptionsButton.textContent = kind === 'image-unsupported' ? '配置截图模型' : '打开配置页'
}

function clearWorkspace(): void {
  releaseWorkspace()
  imageSurface.clear()
  sourceMeta.textContent = ''
  imageStatus.textContent = ''
  fileInput.value = ''
  emptyState.classList.remove('hidden')
  imageStage.classList.add('hidden')
  translateButton.disabled = true
  translateButton.textContent = '翻译选中区域'
  reimportButton.disabled = true
  clearButton.disabled = true
  newSelectionButton.disabled = true
  resetResult('导入图片后，按 Enter 开始翻译')
}

function replaceTask(): number {
  client.cancel()
  translating = false
  return ++taskRevision
}

function releaseWorkspace(): void {
  sourceRevision++
  replaceTask()
  sourceDataUrl = null
  translatedText = ''
  sourceImage.removeAttribute('src')
}

function resetResult(message: string): void {
  lastErrorKind = null
  language.textContent = '自动 → 自动'
  result.className = 'result muted'
  result.textContent = message
  resultError.textContent = ''
  resultError.classList.add('hidden')
  copyButton.disabled = true
  openOptionsButton.classList.add('hidden')
}

async function copyTranslation(): Promise<void> {
  if (!translatedText) return
  const original = copyButton.textContent
  try {
    await navigator.clipboard.writeText(translatedText)
    copyButton.textContent = '已复制'
  } catch {
    copyButton.textContent = '复制失败'
  }
  window.setTimeout(() => {
    copyButton.textContent = original
  }, 1200)
}

function handleSelectionChange(selection: ReturnType<ImageSurface['getSelection']>): void {
  if (!sourceDataUrl) return
  const valid = validCrop(selection)
  imageStatus.textContent = selection === null
    ? '在图片上拖动以创建框选区域'
    : valid
      ? ''
      : '框选区域太小，请继续调整'
  translateButton.disabled = translating || !valid
  translateButton.textContent = '翻译选中区域'
}

function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject())
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function decodeImage(dataUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('invalid image'))
    image.src = dataUrl
  })
}

function sendMessage<T = unknown>(message: RuntimeRequest): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`missing element: ${id}`)
  return element as T
}

function bySelector<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`missing element: ${selector}`)
  return element as T
}
