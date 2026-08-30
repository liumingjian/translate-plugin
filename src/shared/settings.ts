import { DEFAULT_BASE_URL, DEFAULT_IMAGE_MODEL, DEFAULT_MODEL } from './constants'
import type { Settings } from './types'

const KEY = 'settings'

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: DEFAULT_BASE_URL,
  apiKey: '',
  model: DEFAULT_MODEL,
  imageModel: DEFAULT_IMAGE_MODEL,
  imagePrivacyAccepted: false,
  autoReadClipboard: false,
}

/** api-key 只存本机，不进 storage.sync —— 同步到 Google 账号是不必要的暴露面。 */
export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY)
  return migrateSettings(stored[KEY])
}

export function migrateSettings(stored: unknown): Settings {
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_SETTINGS }
  return { ...DEFAULT_SETTINGS, ...(stored as Partial<Settings>) }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: settings })
}

/**
 * 归一化服务地址：去掉尾部斜杠，并吃掉用户顺手带上的尾部 `/v1`。
 *
 * 很多服务的文档就把 base_url 写成 `https://host/v1`，照抄进来会拼出
 * `/v1/v1/chat/completions`。只削掉最后一段 `v1`，`https://host/api/v1`
 * 仍然会还原成 `https://host/api/v1/chat/completions`。
 */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1$/i, '')
    .replace(/\/+$/, '')
}

export function chatCompletionsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/v1/chat/completions`
}

export function modelsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/v1/models`
}
