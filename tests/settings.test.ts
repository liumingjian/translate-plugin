import { describe, expect, it } from 'vitest'
import { chatCompletionsUrl, modelsUrl, normalizeBaseUrl } from '../src/shared/settings'

describe('normalizeBaseUrl', () => {
  it('去掉尾部斜杠', () => {
    expect(normalizeBaseUrl('https://api.example.com/')).toBe('https://api.example.com')
    expect(normalizeBaseUrl('https://api.example.com///')).toBe('https://api.example.com')
  })

  it('去掉两边空白', () => {
    expect(normalizeBaseUrl('  https://api.example.com  ')).toBe('https://api.example.com')
  })

  it('吃掉用户顺手带上的尾部 /v1', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1')).toBe('https://api.example.com')
    expect(normalizeBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com')
    expect(normalizeBaseUrl('https://api.example.com/V1')).toBe('https://api.example.com')
  })

  it('只削最后一段，路径前缀原样保留', () => {
    expect(normalizeBaseUrl('https://api.example.com/api/v1')).toBe('https://api.example.com/api')
    expect(normalizeBaseUrl('https://api.example.com/v1beta')).toBe(
      'https://api.example.com/v1beta',
    )
  })
})

describe('拼接接口地址', () => {
  it('base_url 带不带 /v1 都拼出同一个地址', () => {
    const expected = 'https://api.example.com/v1/chat/completions'
    expect(chatCompletionsUrl('https://api.example.com')).toBe(expected)
    expect(chatCompletionsUrl('https://api.example.com/')).toBe(expected)
    expect(chatCompletionsUrl('https://api.example.com/v1')).toBe(expected)
    expect(chatCompletionsUrl('https://api.example.com/v1/')).toBe(expected)
  })

  it('模型列表地址同理', () => {
    expect(modelsUrl('https://api.example.com/v1')).toBe('https://api.example.com/v1/models')
  })

  it('带路径前缀的服务地址保住前缀', () => {
    expect(chatCompletionsUrl('https://api.example.com/api/v1')).toBe(
      'https://api.example.com/api/v1/chat/completions',
    )
  })
})
