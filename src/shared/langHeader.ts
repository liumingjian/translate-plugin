const HEADER_RE = /^([A-Z]{2})>([A-Z]{2})$/

/** 首行最多允许这么长；超过还没等到换行，就断定模型没遵守协议。 */
const MAX_HEADER_LENGTH = 12

/** 语向标记本身的长度，如 `EN>ZH`。 */
const HEADER_LENGTH = 5

export type LangHeader = { source: string; target: string }

export type ParseResult = {
  /** 本次 feed 解出的语向；只会在整个流中出现一次。 */
  header?: LangHeader
  /** 本次 feed 应追加到译文区的文本，可能为空串。 */
  text: string
}

/**
 * 流式剥离首行语向标记的增量解析器。
 *
 * 兜底规则：首行不匹配 `^[A-Z]{2}>[A-Z]{2}$`（或迟迟不出现换行）时，
 * 已缓冲的内容整体当作译文吐出，后续不再尝试解析语向。
 *
 * 标记前后夹带的空白一律忽略：真实模型的 delta 切分里，
 * 标记前的换行、标记后到换行之间的空格都很常见，
 * 按字符严格比对会把 `EN>ZH` 当成译文吐到卡片里。
 */
export class LangHeaderParser {
  private buffer = ''
  private settled = false

  feed(chunk: string): ParseResult {
    if (this.settled) return { text: chunk }

    this.buffer += chunk
    // 标记之前的空白不算内容，直接丢掉，否则 `\n` 会被当成「首行是空行」。
    this.buffer = this.buffer.replace(/^\s+/, '')
    if (this.buffer === '') return { text: '' }

    const newline = this.buffer.indexOf('\n')

    if (newline === -1) {
      // 还没看到换行：只要缓冲区已经不可能是合法首行，就立刻放弃解析。
      if (this.buffer.length > MAX_HEADER_LENGTH || !couldBeHeader(this.buffer)) {
        return this.giveUp()
      }
      return { text: '' }
    }

    const first = this.buffer.slice(0, newline).trim()
    const rest = this.buffer.slice(newline + 1)
    const match = HEADER_RE.exec(first)
    if (!match) return this.giveUp()

    this.settled = true
    this.buffer = ''
    return {
      header: { source: match[1]!, target: match[2]! },
      text: stripLeadingNewlines(rest),
    }
  }

  /** 流结束时调用，吐出仍滞留在缓冲区里的内容。 */
  flush(): string {
    if (this.settled || this.buffer === '') return ''
    const pending = this.buffer
    this.settled = true
    this.buffer = ''
    return pending
  }

  private giveUp(): ParseResult {
    this.settled = true
    const pending = this.buffer
    this.buffer = ''
    return { text: pending }
  }
}

/** 判断一个尚未收完的片段是否还有希望成为合法语向标记。 */
function couldBeHeader(partial: string): boolean {
  // 标记已经完整时，后面只能是等待换行的空白（此分支里不会有 `\n`）。
  if (partial.length > HEADER_LENGTH) {
    return HEADER_RE.test(partial.slice(0, HEADER_LENGTH)) && /^\s*$/.test(partial.slice(HEADER_LENGTH))
  }
  for (let i = 0; i < partial.length; i++) {
    const ch = partial[i]!
    const ok = i < 2 || i > 2 ? /[A-Z]/.test(ch) : ch === '>'
    if (!ok) return false
  }
  return true
}

function stripLeadingNewlines(text: string): string {
  return text.replace(/^\n+/, '')
}
