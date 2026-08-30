import { PORT_NAME } from './types'
import type { TranslateEvent, TranslateRequest } from './types'

export type TranslationHandlers = {
  onEvent: (event: TranslateEvent) => void
  onDisconnect?: () => void
}

export class TranslationClient {
  private port: chrome.runtime.Port | null = null
  private active = false

  start(request: TranslateRequest, handlers: TranslationHandlers): void {
    this.cancel()
    let port: chrome.runtime.Port
    try {
      port = chrome.runtime.connect({ name: PORT_NAME })
    } catch {
      handlers.onEvent({ type: 'error', kind: 'network', detail: '扩展已更新，请刷新页面' })
      return
    }
    this.port = port
    this.active = true
    port.onMessage.addListener((event: TranslateEvent) => {
      if (this.port !== port) return
      handlers.onEvent(event)
    })
    port.onDisconnect.addListener(() => {
      if (this.port !== port) return
      this.port = null
      const unexpected = this.active
      this.active = false
      if (unexpected) handlers.onDisconnect?.()
    })
    port.postMessage(request)
  }

  finish(): void {
    this.active = false
    this.disconnect()
  }

  cancel(): void {
    this.active = false
    this.disconnect()
  }

  private disconnect(): void {
    if (!this.port) return
    const port = this.port
    this.port = null
    try {
      port.disconnect()
    } catch {
      // 端口可能已经断开。
    }
  }
}
