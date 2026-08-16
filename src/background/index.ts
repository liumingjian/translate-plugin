import { CACHE_CAPACITY } from '../shared/constants'
import { LangHeaderParser } from '../shared/langHeader'
import { Lru } from '../shared/lru'
import { SYSTEM_PROMPT } from '../shared/prompt'
import { checkSelection } from '../shared/selection'
import { chatCompletionsUrl, getSettings, normalizeBaseUrl } from '../shared/settings'
import { PORT_NAME } from '../shared/types'
import type {
  Settings,
  TranslateEvent,
  TranslateRequest,
  TranslationErrorKind,
} from '../shared/types'
import { SseParser, deltaOf, finishReasonOf } from './sse'

type CachedTranslation = { source?: string; target?: string; text: string }

/** 上游瞬时故障：重试一下多半就好了。 */
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

/** 首个 delta 吐出之前最多试这么多次（含第一次）。 */
const MAX_ATTEMPTS = 3

/** 每次重试前的退避，单位毫秒；下标 = 已失败次数 - 1。 */
const RETRY_BACKOFF_MS = [400, 1200]

const cache = new Lru<CachedTranslation>(CACHE_CAPACITY)

chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage()
})

chrome.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message?.type === 'open-options') void chrome.runtime.openOptionsPage()
})

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return

  const abort = new AbortController()
  port.onDisconnect.addListener(() => abort.abort())

  port.onMessage.addListener((message: TranslateRequest) => {
    if (message?.type !== 'translate') return
    const emit = (event: TranslateEvent) => {
      try {
        port.postMessage(event)
      } catch {
        // 页面已关闭或端口已断开，忽略。
      }
    }
    // translate() 自己会把预期内的失败转成 error 事件；这里兜的是它本身抛出的意外
    // （如读取设置失败），不兜住的话卡片会永远转圈。
    translate(message.text, abort.signal, emit).catch((error: unknown) => {
      if (abort.signal.aborted) return
      emit({ type: 'error', kind: 'network', detail: describe(error) })
    })
  })
})

async function translate(
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

    const outcome = await attemptTranslate(settings, check.text, signal, emit)
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
  text: string,
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
      body: JSON.stringify({
        model: settings.model,
        stream: true,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
      }),
    })
  } catch (error) {
    if (signal.aborted) return { kind: 'aborted' }
    return { kind: 'failed', retryable: true, errorKind: 'network', detail: describe(error) }
  }

  if (!response.ok || !response.body) {
    const transient = TRANSIENT_STATUS.has(response.status)
    return {
      kind: 'failed',
      retryable: transient,
      errorKind: authFailure(response.status)
        ? 'auth'
        : transient
          ? 'unavailable'
          : 'network',
      detail: await errorDetail(response),
    }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const sse = new SseParser()
  const header = new LangHeaderParser()
  const collected: CachedTranslation = { text: '' }
  let finished = false
  let emitted = false

  const push = (chunk: string) => {
    if (chunk === '') return
    collected.text += chunk
    emitted = true
    emit({ type: 'delta', text: chunk })
  }

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      for (const payload of sse.feed(decoder.decode(value, { stream: true }))) {
        if (finishReasonOf(payload) !== null) finished = true
        const parsed = header.feed(deltaOf(payload))
        if (parsed.header) {
          collected.source = parsed.header.source
          collected.target = parsed.header.target
          emit({ type: 'lang', ...parsed.header })
        }
        push(parsed.text)
      }
    }
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

  if (collected.text.trim() === '') {
    return { kind: 'failed', retryable: !emitted, errorKind: 'empty' }
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

function authFailure(status: number): boolean {
  return status === 401 || status === 403
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
