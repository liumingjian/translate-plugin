export class PendingImages {
  private readonly entries = new Map<string, { imageDataUrl: string; timer: number }>()

  constructor(private readonly ttlMs: number) {}

  add(token: string, imageDataUrl: string): void {
    this.delete(token)
    const timer = globalThis.setTimeout(() => this.delete(token), this.ttlMs)
    this.entries.set(token, { imageDataUrl, timer })
  }

  consume(token: string): string | undefined {
    const imageDataUrl = this.entries.get(token)?.imageDataUrl
    this.delete(token)
    return imageDataUrl
  }

  delete(token: string): void {
    const entry = this.entries.get(token)
    if (!entry) return
    globalThis.clearTimeout(entry.timer)
    this.entries.delete(token)
  }
}
