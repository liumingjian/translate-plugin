export type Settings = {
  baseUrl: string
  apiKey: string
  model: string
  imageModel: string
  imagePrivacyAccepted: boolean
  autoReadClipboard: boolean
}

export type TranslationErrorKind =
  | 'no-api-key'
  | 'auth'
  | 'network'
  /** 上游 5xx / 429 这类瞬时故障，已经自动重试过仍不行。 */
  | 'unavailable'
  | 'empty'
  | 'too-long'
  | 'image-too-small'
  | 'image-too-large'
  | 'image-unsupported'
  | 'image-privacy-required'
  | 'no-text'

/** content script → service worker：一次翻译请求。 */
export type TranslateRequest =
  | { type: 'translate'; text: string }
  | { type: 'translate-image'; imageDataUrl: string }

/** service worker → content script：流式翻译过程中的事件。 */
export type TranslateEvent =
  | { type: 'lang'; source: string; target: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; cached: boolean }
  | { type: 'error'; kind: TranslationErrorKind; detail?: string }

export const PORT_NAME = 'translate'

export type RuntimeRequest =
  | { type: 'open-options' }
  | { type: 'open-image-model-settings' }
  | { type: 'open-shortcuts' }
  | { type: 'open-workspace' }
  | { type: 'capture-active-tab' }
  | { type: 'consume-pending-image'; token: string }

export type ContentRequest = { type: 'begin-screenshot'; imageDataUrl: string }
