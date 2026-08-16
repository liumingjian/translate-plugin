import { describe, expect, it } from 'vitest'
import { Lru } from '../src/shared/lru'

describe('Lru', () => {
  it('存取往返', () => {
    const lru = new Lru<string>(2)
    lru.set('a', '1')
    expect(lru.get('a')).toBe('1')
  })

  it('未命中返回 undefined', () => {
    expect(new Lru<string>(2).get('nope')).toBeUndefined()
  })

  it('超出容量时淘汰最久未使用的条目', () => {
    const lru = new Lru<string>(2)
    lru.set('a', '1')
    lru.set('b', '2')
    lru.set('c', '3')
    expect(lru.get('a')).toBeUndefined()
    expect(lru.get('b')).toBe('2')
    expect(lru.size).toBe(2)
  })

  it('读取会把条目移到最新端，使其免于淘汰', () => {
    const lru = new Lru<string>(2)
    lru.set('a', '1')
    lru.set('b', '2')
    lru.get('a')
    lru.set('c', '3')
    expect(lru.get('a')).toBe('1')
    expect(lru.get('b')).toBeUndefined()
  })

  it('重复写入同一个 key 不占额外容量', () => {
    const lru = new Lru<string>(2)
    lru.set('a', '1')
    lru.set('a', '2')
    lru.set('b', '3')
    expect(lru.size).toBe(2)
    expect(lru.get('a')).toBe('2')
  })
})
