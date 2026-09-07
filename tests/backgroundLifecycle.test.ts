import { afterEach, describe, expect, it, vi } from 'vitest'

type MessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response?: unknown) => void,
) => boolean | undefined | void

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('background image handoff lifecycle', () => {
  it('releases the pending image when opening the workspace tab fails', async () => {
    let onMessage: MessageListener | undefined
    const create = vi.fn().mockRejectedValue(new Error('tab creation failed'))
    vi.stubGlobal('chrome', {
      commands: { onCommand: { addListener: vi.fn() } },
      runtime: {
        getURL: (path: string) => `chrome-extension://test/${path}`,
        onConnect: { addListener: vi.fn() },
        onMessage: {
          addListener: (listener: MessageListener) => (onMessage = listener),
        },
        openOptionsPage: vi.fn(),
      },
      tabs: {
        captureVisibleTab: vi.fn().mockResolvedValue('data:image/png;base64,Y2FwdHVyZQ=='),
        create,
        query: vi.fn().mockResolvedValue([{ id: 1, windowId: 2 }]),
        sendMessage: vi.fn().mockRejectedValue(new Error('restricted page')),
      },
    })
    await import('../src/background/index')
    expect(onMessage).toBeTypeOf('function')

    const captureResponse = await dispatch(onMessage!, { type: 'capture-active-tab' })
    expect(captureResponse).toMatchObject({ ok: false })
    const workspaceUrl = create.mock.calls[0]?.[0]?.url as string
    const token = new URL(workspaceUrl).searchParams.get('capture')
    expect(token).toBeTruthy()

    expect(await dispatch(onMessage!, { type: 'consume-pending-image', token })).toEqual({
      ok: false,
      imageDataUrl: undefined,
    })
  })
})

function dispatch(listener: MessageListener, message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const asyncResponse = listener(message, {}, resolve)
    if (asyncResponse !== true) resolve(undefined)
  })
}
