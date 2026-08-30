import { checkImageFile } from '../shared/image'
import { langName } from '../shared/lang'
import { getSettings, saveSettings } from '../shared/settings'
import { TranslationClient } from '../shared/translationClient'
import type { RuntimeRequest, TranslateEvent, TranslationErrorKind } from '../shared/types'

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
const sourceMeta = byId<HTMLSpanElement>('sourceMeta')
const imageStatus = byId<HTMLParagraphElement>('imageStatus')
const language = byId<HTMLSpanElement>('language')
const result = byId<HTMLDivElement>('result')
const copyButton = byId<HTMLButtonElement>('copy')
const openOptionsButton = byId<HTMLButtonElement>('openOptions')
const privacyDialog = byId<HTMLDialogElement>('privacyDialog')
const privacyAccept = byId<HTMLButtonElement>('privacyAccept')
const privacyCancel = byId<HTMLButtonElement>('privacyCancel')

const client = new TranslationClient()
let sourceDataUrl: string | null = null
let translatedText = ''
let privacyAccepted = false

void initialize()

async function initialize(): Promise<void> {
  const settings = await getSettings()
  privacyAccepted = settings.imagePrivacyAccepted
  if (!settings.imagePrivacyAccepted) privacyDialog.showModal()

  const token = new URLSearchParams(location.search).get('capture')
  if (!token) return
  const response = await sendMessage<{ ok: boolean; imageDataUrl?: string }>({
    type: 'consume-pending-image',
    token,
  })
  history.replaceState(null, '', location.pathname)
  if (!response.ok || !response.imageDataUrl) {
    imageStatus.textContent = '截图已失效，请重新发起截图翻译'
    return
  }
  await loadSource(response.imageDataUrl, '当前页面截图')
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
translateButton.addEventListener('click', startTranslation)
openOptionsButton.addEventListener('click', () => void sendMessage({ type: 'open-options' }))
copyButton.addEventListener('click', () => void copyTranslation())

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  if (!file) return
  void importFile(file)
})

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.repeat || privacyDialog.open || !sourceDataUrl) return
  if (event.target instanceof HTMLButtonElement) return
  event.preventDefault()
  startTranslation()
})

window.addEventListener('pagehide', () => client.cancel(), { once: true })

function openFilePicker(): void {
  fileInput.value = ''
  fileInput.click()
}

async function importFile(file: File): Promise<void> {
  const check = checkImageFile(file)
  if (!check.ok) {
    imageStatus.textContent = ERROR_MESSAGES[check.reason]
    fileInput.value = ''
    return
  }
  try {
    const dataUrl = await readDataUrl(file)
    await loadSource(dataUrl, file.name)
  } catch {
    imageStatus.textContent = '无法读取这张图片'
    fileInput.value = ''
  }
}

async function loadSource(dataUrl: string, label: string): Promise<void> {
  await decodeImage(dataUrl)
  client.cancel()
  sourceDataUrl = dataUrl
  translatedText = ''
  sourceImage.src = dataUrl
  sourceMeta.textContent = label
  imageStatus.textContent = ''
  emptyState.classList.add('hidden')
  imageStage.classList.remove('hidden')
  translateButton.disabled = false
  reimportButton.disabled = false
  clearButton.disabled = false
  resetResult('已选择整张图片，按 Enter 开始翻译')
}

function startTranslation(): void {
  if (!sourceDataUrl) return
  if (!privacyAccepted) {
    privacyDialog.showModal()
    return
  }
  translatedText = ''
  language.textContent = '自动 → 自动'
  result.textContent = ''
  result.className = 'result loading'
  copyButton.disabled = true
  openOptionsButton.classList.add('hidden')
  translateButton.disabled = true
  translateButton.textContent = '翻译中…'

  client.start(
    { type: 'translate-image', imageDataUrl: sourceDataUrl },
    {
      onEvent: handleEvent,
      onDisconnect: () => showError('network', '连接中断'),
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
  result.classList.remove('loading', 'muted', 'error')
  translateButton.disabled = false
  translateButton.textContent = '重新翻译整张图片'
  copyButton.disabled = translatedText === ''
}

function showError(kind: TranslationErrorKind, detail?: string): void {
  result.className = 'result error'
  result.textContent = detail ? `${ERROR_MESSAGES[kind]}：${detail}` : ERROR_MESSAGES[kind]
  translateButton.disabled = false
  translateButton.textContent = '重试翻译'
  copyButton.disabled = true
  openOptionsButton.classList.toggle('hidden', kind !== 'no-api-key' && kind !== 'auth' && kind !== 'image-unsupported')
}

function clearWorkspace(): void {
  client.cancel()
  sourceDataUrl = null
  translatedText = ''
  sourceImage.removeAttribute('src')
  sourceMeta.textContent = ''
  imageStatus.textContent = ''
  fileInput.value = ''
  emptyState.classList.remove('hidden')
  imageStage.classList.add('hidden')
  translateButton.disabled = true
  translateButton.textContent = '翻译整张图片'
  reimportButton.disabled = true
  clearButton.disabled = true
  resetResult('导入图片后，按 Enter 开始翻译')
}

function resetResult(message: string): void {
  language.textContent = '自动 → 自动'
  result.className = 'result muted'
  result.textContent = message
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

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject())
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
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
