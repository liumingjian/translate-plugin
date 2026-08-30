import { CACHE_CAPACITY } from '../shared/constants'
import { imageChatBody, textChatBody } from '../shared/chat'
import type { ChatRequestBody } from '../shared/chat'
import { LangHeaderParser } from '../shared/langHeader'
import { Lru } from '../shared/lru'
import { checkSelection } from '../shared/selection'
import { chatCompletionsUrl, getSettings, normalizeBaseUrl } from '../shared/settings'
import {
  NoTextOutputBuffer,
  classifyHttpError,
  classifyOutput,
} from '../shared/translationErrors'
import { PORT_NAME } from '../shared/types'
import type {
  ContentRequest,
  RuntimeRequest,
  Settings,
  TranslateEvent,
  TranslateRequest,
  TranslationErrorKind,
} from '../shared/types'
import { SseParser, deltaOf, finishReasonOf } from './sse'

type CachedTranslation = { source?: string; target?: string; text: string }

/** 首个 delta 吐出之前最多试这么多次（含第一次）。 */
const MAX_ATTEMPTS = 3

/** 每次重试前的退避，单位毫秒；下标 = 已失败次数 - 1。 */
const RETRY_BACKOFF_MS = [400, 1200]

const cache = new Lru<CachedTranslation>(CACHE_CAPACITY)
const pendingImages = new Map<string, string>()

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'screenshot-translate') void captureActiveTab(tab)
})

chrome.runtime.onMessage.addListener(
  (message: RuntimeRequest, _sender, sendResponse: (response?: unknown) => void) => {
    switch (message?.type) {
      case 'open-options':
        void chrome.runtime.openOptionsPage()
        return
      case 'open-shortcuts':
        void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
        return
      case 'open-workspace':
        void openWorkspace()
        return
      case 'capture-active-tab':
        void captureActiveTab()
          .then(() => sendResponse({ ok: true }))
          .catch((error: unknown) => sendResponse({ ok: false, error: describe(error) }))
        return true
      case 'consume-pending-image': {
        const imageDataUrl = pendingImages.get(message.token)
        pendingImages.delete(message.token)
        sendResponse({ ok: !!imageDataUrl, imageDataUrl })
        return
      }
    }
  },
)

async function captureActiveTab(commandTab?: chrome.tabs.Tab): Promise<void> {
  const tab = commandTab?.id
    ? commandTab
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
  if (!tab?.id || tab.windowId === undefined) throw new Error('没有可截图的活动标签页')
  const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
  const message: ContentRequest = { type: 'begin-screenshot', imageDataUrl }
  try {
    await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 })
  } catch {
    await openWorkspace(imageDataUrl)
  }
}

async function openWorkspace(imageDataUrl?: string): Promise<void> {
  let suffix = ''
  if (imageDataUrl) {
    const token = crypto.randomUUID()
    pendingImages.set(token, imageDataUrl)
    suffix = `?capture=${encodeURIComponent(token)}`
    globalThis.setTimeout(() => pendingImages.delete(token), 60_000)
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL(`src/workspace/index.html${suffix}`) })
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return

  const abort = new AbortController()
  port.onDisconnect.addListener(() => abort.abort())

  port.onMessage.addListener((message: TranslateRequest) => {
    const emit = (event: TranslateEvent) => {
      try {
        port.postMessage(event)
      } catch {
        // 页面已关闭或端口已断开，忽略。
      }
    }
    // translate() 自己会把预期内的失败转成 error 事件；这里兜的是它本身抛出的意外
    // （如读取设置失败），不兜住的话卡片会永远转圈。
    const task =
      message?.type === 'translate'
        ? translateText(message.text, abort.signal, emit)
        : message?.type === 'translate-image'
          ? translateImage(message.imageDataUrl, abort.signal, emit)
          : Promise.resolve()
    task.catch((error: unknown) => {
      if (abort.signal.aborted) return
      emit({ type: 'error', kind: 'network', detail: describe(error) })
    })
  })
})

async function translateText(
  raw: string,
  signal: AbortSignal,
  emit: (event: TranslateEvent) => void,
): Promise<void> {
  const check = checkSelection(raw)
  if (!check.ok) {
    emit({ type: 'error', kind: check.reason === 'empty' ? 'empty' : 'too-long' })
    return
  }

  const settings = await getSettings()
  if (settings.apiKey.trim() === '') {
    emit({ type: 'error', kind: 'no-api-key' })
    return
  }

  // 缓存 key 必须带上服务地址：同名模型在不同服务上是不同的东西，
  // 只按 model 建 key 会把 A 服务的译文喂给 B 服务。
  const cacheKey = `${normalizeBaseUrl(settings.baseUrl)}\n${settings.model}\n${check.text}`
  const hit = cache.get(cacheKey)
  if (hit) {
    if (hit.source && hit.target) emit({ type: 'lang', source: hit.source, target: hit.target })
    emit({ type: 'delta', text: hit.text })
    emit({ type: 'done', cached: true })
    return
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_BACKOFF_MS[attempt - 1] ?? 1200, signal)
      if (signal.aborted) return
    }

    const outcome = await attemptTranslate(
      settings,
      textChatBody(settings, check.text),
      false,
      signal,
      emit,
    )
    if (outcome.kind === 'aborted') return
    if (outcome.kind === 'ok') {
      // 被掐断的流不进缓存，否则半截译文会一直命中，用户重试也甩不掉。
      if (outcome.complete) cache.set(cacheKey, outcome.collected)
      emit({ type: 'done', cached: false })
      return
    }
    if (outcome.retryable && attempt < MAX_ATTEMPTS - 1) continue
    emit({ type: 'error', kind: outcome.errorKind, detail: outcome.detail })
    return
  }
}

async function translateImage(
  imageDataUrl: string,
  signal: AbortSignal,
  emit: (event: TranslateEvent) => void,
): Promise<void> {
  if (!/^data:image\/(?:png|jpeg|webp);base64,/i.test(imageDataUrl)) {
    emit({ type: 'error', kind: 'image-unsupported' })
    return
  }
  if (imageDataUrl.length > 28_000_000) {
    emit({ type: 'error', kind: 'image-too-large' })
    return
  }
  const settings = await getSettings()
  if (settings.apiKey.trim() === '') {
    emit({ type: 'error', kind: 'no-api-key' })
    return
  }
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_BACKOFF_MS[attempt - 1] ?? 1200, signal)
      if (signal.aborted) return
    }
    const outcome = await attemptTranslate(
      settings,
      imageChatBody(settings, imageDataUrl),
      true,
      signal,
      emit,
    )
    if (outcome.kind === 'aborted') return
    if (outcome.kind === 'ok') {
      emit({ type: 'done', cached: false })
      return
    }
    if (outcome.retryable && attempt < MAX_ATTEMPTS - 1) continue
    emit({ type: 'error', kind: outcome.errorKind, detail: outcome.detail })
    return
  }
}

type Attempt =
  | { kind: 'ok'; collected: CachedTranslation; complete: boolean }
  | { kind: 'aborted' }
  | { kind: 'failed'; retryable: boolean; errorKind: TranslationErrorKind; detail?: string }

/**
 * 跑一次完整请求。只有在**还没吐出任何译文**时失败才允许重试 ——
 * 流到一半断掉再重来会让卡片里出现两段译文。
 */
async function attemptTranslate(
  settings: Settings,
  body: ChatRequestBody,
  imageRequest: boolean,
  signal: AbortSignal,
  emit: (event: TranslateEvent) => void,
): Promise<Attempt> {
  let response: Response
  try {
    response = await fetch(chatCompletionsUrl(settings.baseUrl), {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    if (signal.aborted) return { kind: 'aborted' }
    return { kind: 'failed', retryable: true, errorKind: 'network', detail: describe(error) }
  }

  if (!response.ok || !response.body) {
    const detail = await errorDetail(response)
    const classified =
      response.ok && imageRequest
        ? { kind: 'empty' as const, retryable: false }
        : classifyHttpError(response.status, detail, imageRequest)
    return {
      kind: 'failed',
      retryable: classified.retryable,
      errorKind: classified.kind,
      detail,
    }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const sse = new SseParser()
  const header = new LangHeaderParser()
  const collected: CachedTranslation = { text: '' }
  let finished = false
  let emitted = false
  const noTextBuffer = imageRequest ? new NoTextOutputBuffer() : null
  let sawNoText = false

  const push = (chunk: string) => {
    if (chunk === '') return
    collected.text += chunk
    emitted = true
    emit({ type: 'delta', text: chunk })
  }

  const parseDelta = (chunk: string) => {
    chunk = noTextBuffer?.feed(chunk) ?? chunk
    const parsed = header.feed(chunk)
    if (parsed.header) {
      collected.source = parsed.header.source
      collected.target = parsed.header.target
      emit({ type: 'lang', ...parsed.header })
    }
    push(parsed.text)
  }

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      for (const payload of sse.feed(decoder.decode(value, { stream: true }))) {
        if (finishReasonOf(payload) !== null) finished = true
        parseDelta(deltaOf(payload))
      }
    }
    const tail = noTextBuffer?.finish()
    if (tail?.noText) sawNoText = true
    else parseDelta(tail?.text ?? '')
    push(header.flush())
  } catch (error) {
    if (signal.aborted) return { kind: 'aborted' }
    // 已经吐过译文就不能重来了，只能把错误摆到用户面前。
    return {
      kind: 'failed',
      retryable: !emitted,
      errorKind: 'network',
      detail: describe(error),
    }
  }

  const outputError = classifyOutput(sawNoText ? 'NO_TEXT' : collected.text, imageRequest)
  if (outputError) {
    return { kind: 'failed', retryable: outputError === 'empty' && !emitted, errorKind: outputError }
  }

  return { kind: 'ok', collected, complete: sse.sawDone || finished }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

async function errorDetail(response: Response): Promise<string> {
  const fallback = `HTTP ${response.status}`
  try {
    const body = await response.text()
    const parsed = JSON.parse(body) as { error?: { message?: string } }
    return parsed.error?.message ?? body.slice(0, 200) ?? fallback
  } catch {
    return fallback
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export type { TranslationErrorKind }
