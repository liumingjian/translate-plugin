import { MAX_SELECTION_LENGTH } from './constants'

export type SelectionCheck =
  | { ok: true; text: string }
  | { ok: false; reason: 'empty' | 'too-long' }

/**
 * 判定一段选区文本能否进入翻译流程。
 * 长度以「去掉首尾空白后的字符数」计，避免用户误拖出的大片空白触发拒绝。
 */
export function checkSelection(raw: string): SelectionCheck {
  const text = raw.trim()
  if (text === '') return { ok: false, reason: 'empty' }
  if (text.length > MAX_SELECTION_LENGTH) return { ok: false, reason: 'too-long' }
  return { ok: true, text }
}
