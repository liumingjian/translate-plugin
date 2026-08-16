import { describe, expect, it } from 'vitest'
import { LangHeaderParser } from '../src/shared/langHeader'

function drain(chunks: string[]) {
  const parser = new LangHeaderParser()
  let header: { source: string; target: string } | undefined
  let text = ''
  for (const chunk of chunks) {
    const result = parser.feed(chunk)
    if (result.header) header = result.header
    text += result.text
  }
  text += parser.flush()
  return { header, text }
}

describe('LangHeaderParser', () => {
  it('剥离一次性到达的语向标记', () => {
    expect(drain(['EN>ZH\n你好世界'])).toEqual({
      header: { source: 'EN', target: 'ZH' },
      text: '你好世界',
    })
  })

  it('语向标记被切成任意碎片也能拼回来', () => {
    expect(drain(['E', 'N', '>', 'Z', 'H', '\n你', '好'])).toEqual({
      header: { source: 'EN', target: 'ZH' },
      text: '你好',
    })
  })

  it('剥掉标记后紧跟的多余换行', () => {
    expect(drain(['ZH>EN\n\n\nHello']).text).toBe('Hello')
  })

  it('首行不合法时整体当译文，不吞字', () => {
    const result = drain(['这是一段没有标记的译文\n第二行'])
    expect(result.header).toBeUndefined()
    expect(result.text).toBe('这是一段没有标记的译文\n第二行')
  })

  it('一开始就不像标记时立刻放弃解析', () => {
    const parser = new LangHeaderParser()
    expect(parser.feed('你好').text).toBe('你好')
    expect(parser.feed('世界').text).toBe('世界')
  })

  it('迟迟不出现换行时放弃解析并吐回缓冲内容', () => {
    const result = drain(['ABCDEFGHIJKLMN'])
    expect(result.header).toBeUndefined()
    expect(result.text).toBe('ABCDEFGHIJKLMN')
  })

  it('三字母语言码不算合法标记', () => {
    const result = drain(['ENG>ZHO\nfoo'])
    expect(result.header).toBeUndefined()
    expect(result.text).toBe('ENG>ZHO\nfoo')
  })

  it('只有标记没有译文时不产出文本', () => {
    expect(drain(['EN>ZH\n'])).toEqual({ header: { source: 'EN', target: 'ZH' }, text: '' })
  })

  it('解析完成后的换行原样保留', () => {
    expect(drain(['EN>ZH\n第一行\n第二行']).text).toBe('第一行\n第二行')
  })
})

/**
 * QA 补充：真实模型的 delta 切分里，语向标记前后很容易夹带空白。
 * 前两条曾经是红的（尾随空格单独成 chunk / 前导换行），见 QA 报告 B2。
 */
describe('LangHeaderParser · 标记前后夹带空白', () => {
  it('标记后跟一个空格再换行（空格单独成 chunk）', () => {
    expect(drain(['EN', '>', 'ZH', ' ', '\n', '你好'])).toEqual({
      header: { source: 'EN', target: 'ZH' },
      text: '你好',
    })
  })

  it('标记前有一个前导换行', () => {
    expect(drain(['\n', 'EN>ZH\n你好'])).toEqual({
      header: { source: 'EN', target: 'ZH' },
      text: '你好',
    })
  })

  it('标记前有一个前导空格', () => {
    expect(drain([' EN>ZH\n你好'])).toEqual({
      header: { source: 'EN', target: 'ZH' },
      text: '你好',
    })
  })
})

describe('LangHeaderParser · 空白容忍不能吃掉兜底', () => {
  it('前导空白后不是合法标记时，整体当译文', () => {
    // 标记前的空白本身被丢弃（它不是译文内容），其余原样吐出。
    expect(drain(['  ', 'Hello world\n第二行'])).toEqual({
      header: undefined,
      text: 'Hello world\n第二行',
    })
  })

  it('标记后跟的空白太长时放弃解析', () => {
    expect(drain(['EN>ZH', '        ', '   ']).header).toBeUndefined()
  })
})
