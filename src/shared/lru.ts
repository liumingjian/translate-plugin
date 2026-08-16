/** 最近最少使用缓存。命中会把条目移到最新端。 */
export class Lru<V> {
  private readonly map = new Map<string, V>()

  constructor(private readonly capacity: number) {}

  get(key: string): V | undefined {
    if (!this.map.has(key)) return undefined
    const value = this.map.get(key)!
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next()
      if (!oldest.done) this.map.delete(oldest.value)
    }
  }

  get size(): number {
    return this.map.size
  }
}
