import { afterEach, describe, expect, it, vi } from 'vitest'
import { TranslationClient } from '../src/shared/translationClient'

type Listener<T> = (value: T) => void

class FakePort {
  readonly messages: unknown[] = []
  readonly messageListeners: Listener<unknown>[] = []
  readonly disconnectListeners: Array<() => void> = []
  disconnectCount = 0

  onMessage = {
    addListener: (listener: Listener<unknown>) => this.messageListeners.push(listener),
  }

  onDisconnect = {
    addListener: (listener: () => void) => this.disconnectListeners.push(listener),
  }

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  disconnect(): void {
    this.disconnectCount++
    for (const listener of this.disconnectListeners) listener()
  }

  drop(): void {
    for (const listener of this.disconnectListeners) listener()
  }
}

function installPorts(...ports: FakePort[]) {
  const connect = vi.fn(() => ports.shift() as unknown as chrome.runtime.Port)
  vi.stubGlobal('chrome', { runtime: { connect } })
  return connect
}

afterEach(() => vi.unstubAllGlobals())

describe('TranslationClient', () => {
  it('sends the existing text request without changing its protocol', () => {
    const port = new FakePort()
    const connect = installPorts(port)
    const client = new TranslationClient()

    client.start({ type: 'translate', text: 'Hello' }, { onEvent: vi.fn() })

    expect(connect).toHaveBeenCalledWith({ name: 'translate' })
    expect(port.messages).toEqual([{ type: 'translate', text: 'Hello' }])
  })

  it('disconnects the active request when cancelled', () => {
    const port = new FakePort()
    installPorts(port)
    const onDisconnect = vi.fn()
    const client = new TranslationClient()
    client.start({ type: 'translate-image', imageDataUrl: 'data:image/png;base64,eA==' }, {
      onEvent: vi.fn(),
      onDisconnect,
    })

    client.cancel()

    expect(port.disconnectCount).toBe(1)
    expect(onDisconnect).not.toHaveBeenCalled()
  })

  it('cancels the previous request before starting a replacement', () => {
    const first = new FakePort()
    const second = new FakePort()
    installPorts(first, second)
    const client = new TranslationClient()

    client.start({ type: 'translate', text: 'first' }, { onEvent: vi.fn() })
    client.start({ type: 'translate', text: 'second' }, { onEvent: vi.fn() })

    expect(first.disconnectCount).toBe(1)
    expect(second.messages).toEqual([{ type: 'translate', text: 'second' }])
  })

  it('reports only unexpected port disconnections', () => {
    const port = new FakePort()
    installPorts(port)
    const onDisconnect = vi.fn()
    const client = new TranslationClient()
    client.start({ type: 'translate', text: 'Hello' }, { onEvent: vi.fn(), onDisconnect })

    port.drop()

    expect(onDisconnect).toHaveBeenCalledOnce()
  })
})
