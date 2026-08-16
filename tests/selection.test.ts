import { describe, expect, it } from 'vitest'
import { MAX_SELECTION_LENGTH } from '../src/shared/constants'
import { checkSelection } from '../src/shared/selection'

describe('checkSelection', () => {
  it('去掉首尾空白', () => {
    expect(checkSelection('  hello  ')).toEqual({ ok: true, text: 'hello' })
  })

  it('纯空白视为空选区', () => {
    expect(checkSelection(' \n\t ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('刚好到上限仍然放行', () => {
    const text = 'a'.repeat(MAX_SELECTION_LENGTH)
    expect(checkSelection(text)).toEqual({ ok: true, text })
  })

  it('超过上限直接拒绝，不截断', () => {
    expect(checkSelection('a'.repeat(MAX_SELECTION_LENGTH + 1))).toEqual({
      ok: false,
      reason: 'too-long',
    })
  })

  it('长度按去空白后计算', () => {
    const text = `   ${'a'.repeat(MAX_SELECTION_LENGTH)}   `
    expect(checkSelection(text).ok).toBe(true)
  })
})
