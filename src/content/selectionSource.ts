import type { Rect } from '../shared/position'

/**
 * 一次选区的读数：选中的文本，加一个能随页面滚动重新求值的锚点矩形。
 * 矩形做成函数而不是快照，是因为图标要跟着选区滚。
 */
export type SelectionCapture = {
  text: string
  rect: () => Rect | null
}

/** 会把选区藏在自己内部、不上报给 document 的输入控件类型。password 不译。 */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', ''])

/**
 * 读取当前选区。
 *
 * 不能只信 `document.getSelection()`：在 input/textarea 和 shadow DOM 里选字时，
 * Chrome 给出的 document 选区是 **collapsed 且一个矩形都没有** 的，
 * 尽管 `toString()` 里文本俱全。按 `isCollapsed` 判空，这两类页面就永远不出划词图标。
 */
export function readSelection(): SelectionCapture | null {
  const editable = editableCapture()
  if (editable) return editable

  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)

  const shadow = shadowCapture(boundaryNode(range))
  if (shadow) return shadow

  const text = selection.toString()
  if (text.trim() === '') return null
  const cloned = range.cloneRange()
  return { text, rect: () => rangeRect(cloned) }
}

/** input/textarea 的选区只能从控件自己身上读。 */
function editableCapture(): SelectionCapture | null {
  const element = deepActiveElement()
  const isTextarea = element instanceof HTMLTextAreaElement
  const isTextInput = element instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(element.type)
  if (!isTextarea && !isTextInput) return null

  const field = element as HTMLInputElement | HTMLTextAreaElement
  const { selectionStart: start, selectionEnd: end } = field
  if (start === null || end === null || start === end) return null

  const text = field.value.slice(start, end)
  if (text.trim() === '') return null
  // 控件内部没有可用的文本矩形，只能拿控件本身当锚点。
  return { text, rect: () => elementRect(field) }
}

/**
 * 穿透 shadow root 再读一次选区。`ShadowRoot.getSelection()` 是 Blink 的遗留 API，
 * 但它是目前唯一能拿到 shadow 内部 Range（进而拿到矩形）的路子。
 */
function shadowCapture(node: Node | null): SelectionCapture | null {
  const root = (node instanceof Element ? node : null)?.shadowRoot
  const selection = root ? getShadowSelection(root) : null
  if (!selection || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  // shadow 还可以再套 shadow，一层层往下钻到真正持有文本的那层。
  const deeper = shadowCapture(boundaryNode(range))
  if (deeper) return deeper

  const text = selection.toString()
  if (text.trim() === '') return null
  const cloned = range.cloneRange()
  return { text, rect: () => rangeRect(cloned) }
}

type SelectionCarrier = { getSelection?: () => Selection | null }

function getShadowSelection(root: ShadowRoot): Selection | null {
  return (root as unknown as SelectionCarrier).getSelection?.() ?? null
}

/** collapsed 的 Range 指向的那个节点 —— shadow 选区在外层就表现为「指着宿主元素」。 */
function boundaryNode(range: Range): Node | null {
  const container = range.startContainer
  return container.childNodes[range.startOffset] ?? container
}

/** 焦点可能落在 shadow DOM 深处，document.activeElement 只给到最外层宿主。 */
function deepActiveElement(): Element | null {
  let element = document.activeElement
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement
  return element
}

/** 取选区末端矩形 —— 图标锚在这里，跟用户松开鼠标的位置一致。 */
function rangeRect(range: Range): Rect | null {
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 || rect.height > 0,
  )
  const last = rects[rects.length - 1] ?? range.getBoundingClientRect()
  if (last.width === 0 && last.height === 0) return null
  return { left: last.left, top: last.top, right: last.right, bottom: last.bottom }
}

function elementRect(element: Element): Rect | null {
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}
