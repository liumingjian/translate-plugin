import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  chatCompletionsUrl,
  migrateSettings,
  modelsUrl,
  normalizeBaseUrl,
} from '../src/shared/settings'

describe('settings migration', () => {
  it('preserves legacy service credentials and text model while adding image defaults', () => {
    expect(
      migrateSettings({
        baseUrl: 'https://legacy.example.com',
        apiKey: 'legacy-key',
        model: 'legacy-text-model',
      }),
    ).toEqual({
      baseUrl: 'https://legacy.example.com',
      apiKey: 'legacy-key',
      model: 'legacy-text-model',
      imageModel: 'gpt-5.5',
      imagePrivacyAccepted: false,
      autoReadClipboard: false,
    })
  })

  it('preserves image settings already saved by a newer version', () => {
    const stored = {
      ...DEFAULT_SETTINGS,
      imageModel: 'custom-vision-model',
      imagePrivacyAccepted: true,
      autoReadClipboard: true,
    }
    expect(migrateSettings(stored)).toEqual(stored)
  })

  it('uses all defaults when there are no stored settings', () => {
    expect(migrateSettings(undefined)).toEqual(DEFAULT_SETTINGS)
  })
})

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
