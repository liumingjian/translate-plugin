import { describe, expect, it } from 'vitest'
import { SseParser, deltaOf, finishReasonOf } from '../src/background/sse'

const chunk = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`

describe('SseParser', () => {
  it('切出逐条 data 载荷', () => {
    const parser = new SseParser()
    expect(parser.feed(chunk('a') + chunk('b')).map(deltaOf)).toEqual(['a', 'b'])
  })

  it('跨 chunk 的半行会被缓冲到下一次', () => {
    const parser = new SseParser()
    const full = chunk('hello')
    expect(parser.feed(full.slice(0, 20))).toEqual([])
    expect(parser.feed(full.slice(20)).map(deltaOf)).toEqual(['hello'])
  })

  it('忽略 [DONE] 与空行', () => {
    const parser = new SseParser()
    expect(parser.feed('\ndata: [DONE]\n\n')).toEqual([])
  })

  it('忽略非 data 行', () => {
    const parser = new SseParser()
    expect(parser.feed(': keep-alive\nevent: ping\n')).toEqual([])
  })
})

describe('deltaOf', () => {
  it('取出增量内容', () => {
    expect(deltaOf(JSON.stringify({ choices: [{ delta: { content: 'x' } }] }))).toBe('x')
  })

  it('结构不符或非 JSON 时返回空串而不是抛错', () => {
    expect(deltaOf('not json')).toBe('')
    expect(deltaOf(JSON.stringify({ choices: [{ delta: {} }] }))).toBe('')
    expect(deltaOf(JSON.stringify({ choices: [{ delta: { content: null } }] }))).toBe('')
  })
})

describe('流是否完整（决定要不要进缓存）', () => {
  it('见到 [DONE] 才算服务说完了', () => {
    const parser = new SseParser()
    parser.feed('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n')
    expect(parser.sawDone).toBe(false)
    parser.feed('data: [DONE]\n\n')
    expect(parser.sawDone).toBe(true)
  })

  it('finish_reason 也能表示收尾', () => {
    expect(finishReasonOf('{"choices":[{"delta":{},"finish_reason":"stop"}]}')).toBe('stop')
    expect(finishReasonOf('{"choices":[{"delta":{"content":"x"}}]}')).toBeNull()
    expect(finishReasonOf('不是 JSON')).toBeNull()
  })

  it('发出部分 delta 后没有结束标记仍视为断流', () => {
    const parser = new SseParser()
    expect(parser.feed(chunk('EN>ZH\n半段')).map(deltaOf)).toEqual(['EN>ZH\n半段'])
    expect(parser.complete).toBe(false)
  })

  it('finish_reason 或 [DONE] 都把流标为完整', () => {
    const byReason = new SseParser()
    byReason.feed('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n')
    expect(byReason.complete).toBe(true)

    const byDone = new SseParser()
    byDone.feed('data: [DONE]\n\n')
    expect(byDone.complete).toBe(true)
  })
})
