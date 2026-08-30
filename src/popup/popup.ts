import type { RuntimeRequest } from '../shared/types'

const screenshot = byId<HTMLButtonElement>('screenshot')
const importImage = byId<HTMLButtonElement>('import')
const options = byId<HTMLButtonElement>('options')
const status = byId<HTMLParagraphElement>('status')

screenshot.addEventListener('click', () => {
  setBusy(true)
  void send<{ ok: boolean; error?: string }>({ type: 'capture-active-tab' })
    .then((response) => {
      if (!response.ok) throw new Error(response.error || '无法捕获当前页面')
      window.close()
    })
    .catch((error: unknown) => {
      status.textContent = error instanceof Error ? error.message : String(error)
      setBusy(false)
    })
})

importImage.addEventListener('click', () => {
  void send({ type: 'open-workspace' }).then(() => window.close())
})

options.addEventListener('click', () => {
  void send({ type: 'open-options' }).then(() => window.close())
})

function setBusy(busy: boolean): void {
  screenshot.disabled = busy
  importImage.disabled = busy
  options.disabled = busy
}

function send<T = unknown>(message: RuntimeRequest): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`missing element: ${id}`)
  return element as T
}
