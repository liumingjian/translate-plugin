import { DEFAULT_BASE_URL } from '../shared/constants'
import {
  DEFAULT_SETTINGS,
  getSettings,
  modelsUrl,
  normalizeBaseUrl,
  saveSettings,
} from '../shared/settings'

const baseUrlInput = byId<HTMLInputElement>('baseUrl')
const apiKeyInput = byId<HTMLInputElement>('apiKey')
const modelInput = byId<HTMLInputElement>('model')
const imageModelInput = byId<HTMLInputElement>('imageModel')
const modelSelect = byId<HTMLSelectElement>('modelSelect')
const fetchButton = byId<HTMLButtonElement>('fetchModels')
const saveButton = byId<HTMLButtonElement>('save')
const shortcutsButton = byId<HTMLButtonElement>('shortcuts')
const status = byId<HTMLSpanElement>('status')

void (async () => {
  const settings = await getSettings()
  baseUrlInput.value = settings.baseUrl
  apiKeyInput.value = settings.apiKey
  modelInput.value = settings.model
  imageModelInput.value = settings.imageModel
})()

saveButton.addEventListener('click', () => {
  const baseUrl = normalizeBaseUrl(baseUrlInput.value) || DEFAULT_BASE_URL
  const checked = checkOrigin(baseUrl)
  if (!checked.ok) {
    report(checked.message, 'error')
    return
  }

  // 权限申请必须在用户手势里同步发起，因此不能先 await 任何东西。
  const granted = requestOrigin(checked.origin)

  void granted.then(async (ok) => {
    if (!ok) {
      report('未授权访问该服务地址，配置没有保存', 'error')
      return
    }
    const current = await getSettings()
    await saveSettings({
      ...current,
      baseUrl,
      apiKey: apiKeyInput.value.trim(),
      model: modelInput.value.trim() || DEFAULT_SETTINGS.model,
      imageModel: imageModelInput.value.trim() || DEFAULT_SETTINGS.imageModel,
    })
    baseUrlInput.value = baseUrl
    report('已保存', 'ok')
  })
})

shortcutsButton.addEventListener('click', () => {
  void chrome.runtime.sendMessage({ type: 'open-shortcuts' })
})

fetchButton.addEventListener('click', () => {
  const baseUrl = normalizeBaseUrl(baseUrlInput.value) || DEFAULT_BASE_URL
  const checked = checkOrigin(baseUrl)
  if (!checked.ok) {
    report(checked.message, 'error')
    return
  }

  const granted = requestOrigin(checked.origin)

  void granted.then(async (ok) => {
    if (!ok) {
      report('未授权访问该服务地址', 'error')
      return
    }
    report('拉取中…')
    try {
      const response = await fetch(modelsUrl(baseUrl), {
        headers: { Authorization: `Bearer ${apiKeyInput.value.trim()}` },
      })
      if (!response.ok) {
        report(`拉取失败：HTTP ${response.status}`, 'error')
        return
      }
      const body = (await response.json()) as { data?: { id?: string }[] }
      const ids = (body.data ?? []).map((item) => item.id).filter(isString)
      if (ids.length === 0) {
        report('服务没有返回任何模型', 'error')
        return
      }
      renderModels(ids)
      report(`已拉取 ${ids.length} 个模型，在下面的下拉框里选`, 'ok')
    } catch (error) {
      report(`拉取失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  })
})

// 选中下拉项即写回输入框；输入框仍然可以手填列表里没有的模型。
modelSelect.addEventListener('change', () => {
  modelInput.value = modelSelect.value
})

modelInput.addEventListener('input', () => {
  syncSelect()
})

/**
 * 用 select 而不是 datalist：datalist 只有在已输入内容能前缀匹配到候选时才弹，
 * 输入框里预填了默认模型时用户根本看不到任何候选。
 */
function renderModels(ids: string[]): void {
  modelSelect.replaceChildren(
    ...ids.map((id) => {
      const option = document.createElement('option')
      option.value = id
      option.textContent = id
      return option
    }),
  )
  modelSelect.classList.remove('hidden')
  syncSelect()
}

/** 让下拉框跟着输入框走；手填了列表外的模型时不选中任何一项。 */
function syncSelect(): void {
  const options = Array.from(modelSelect.options)
  const matched = options.find((option) => option.value === modelInput.value)
  modelSelect.selectedIndex = matched ? options.indexOf(matched) : -1
}

type OriginCheck = { ok: true; origin: string } | { ok: false; message: string }

/**
 * 校验服务地址。manifest 里的 optional_host_permissions 只覆盖 https 源，
 * 对 http 地址申请权限会被 Chrome 直接拒掉 —— 那样用户只会看到「未授权」，
 * 完全猜不到真正原因，所以这里提前说清楚。
 */
function checkOrigin(baseUrl: string): OriginCheck {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return { ok: false, message: '服务地址不是合法的 URL' }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, message: '只支持 https 的服务地址' }
  }
  return { ok: true, origin: url.origin }
}

/** 默认服务已经在 host_permissions 里，不必再问一次。 */
function requestOrigin(origin: string): Promise<boolean> {
  if (origin === originOf(DEFAULT_BASE_URL)) return Promise.resolve(true)
  return chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false)
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

function report(message: string, kind: 'ok' | 'error' | 'info' = 'info'): void {
  status.textContent = message
  status.className = kind === 'info' ? 'status' : `status ${kind}`
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`missing element: ${id}`)
  return element as T
}
