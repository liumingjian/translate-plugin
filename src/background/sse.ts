/** 把 SSE 字节流增量切成一条条 `data:` 载荷。`[DONE]` 会被过滤掉。 */
export class SseParser {
  private buffer = ''
  private done = false

  /** 是否收到过 `[DONE]` —— 用来区分「服务说完了」和「连接被掐断」。 */
  get sawDone(): boolean {
    return this.done
  }

  feed(chunk: string): string[] {
    this.buffer += chunk
    const payloads: string[] = []
    let newline: number

    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') {
        this.done = true
        continue
      }
      if (data === '') continue
      payloads.push(data)
    }

    return payloads
  }
}

/** 取出一条载荷里的 finish_reason；没有就是 null。 */
export function finishReasonOf(payload: string): string | null {
  try {
    const parsed = JSON.parse(payload) as { choices?: { finish_reason?: string | null }[] }
    return parsed.choices?.[0]?.finish_reason ?? null
  } catch {
    return null
  }
}

/** 从一条 chat.completion.chunk 载荷里取出增量文本，取不到就返回空串。 */
export function deltaOf(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as {
      choices?: { delta?: { content?: string | null } }[]
    }
    return parsed.choices?.[0]?.delta?.content ?? ''
  } catch {
    return ''
  }
}
