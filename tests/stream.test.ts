import { describe, expect, it } from 'vitest'
import { SseParser, deltaOf } from '../src/background/sse'
import { LangHeaderParser } from '../src/shared/langHeader'
import fixture from './fixtures/stream.sse?raw'

/**
 * 真实 API 抓下来的一段 SSE（gpt-5.4-mini，英译中），用来锁住
 * 「SSE 切分 → 取增量 → 剥语向标记」这整条流式链路。
 */

function replay(chunkSize: number) {
  const sse = new SseParser()
  const header = new LangHeaderParser()
  let lang: { source: string; target: string } | undefined
  let text = ''

  for (let i = 0; i < fixture.length; i += chunkSize) {
    for (const payload of sse.feed(fixture.slice(i, i + chunkSize))) {
      const result = header.feed(deltaOf(payload))
      if (result.header) lang = result.header
      text += result.text
    }
  }
  text += header.flush()
  return { lang, text }
}

describe('流式链路（真实响应回放）', () => {
  it('解出语向并还原完整译文', () => {
    const { lang, text } = replay(fixture.length)
    expect(lang).toEqual({ source: 'EN', target: 'ZH' })
    expect(text).not.toMatch(/^[A-Z]{2}>[A-Z]{2}/)
    expect(text).toContain('AGENTS.md')
    expect(text).toMatch(/[一-龥]/)
  })

  it('无论字节流怎么切分，结果都一致', () => {
    const whole = replay(fixture.length)
    for (const size of [1, 7, 64, 999]) {
      expect(replay(size)).toEqual(whole)
    }
  })
})
