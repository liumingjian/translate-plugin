---
status: accepted
---

# 选区读取要穿透 input/textarea 与 shadow DOM，而不是只信 document 选区

原来的实现用 `document.getSelection()` 判断有没有选区，并以 `isCollapsed` 作为「什么都没选」的信号。这在普通段落上没问题，但在两类页面上划词图标彻底不出现：**input/textarea 里的选区**，以及**文本活在 shadow root 里的页面**（Web Component 站点、以及大量把内容塞进自定义元素的现代前端）。Chrome 在这两种情况下给出的 document 选区是 collapsed 的，`getClientRects()` 一个矩形都没有 —— 尽管 `toString()` 里文本俱全。于是选区读取改成分层：先问输入控件自己，再穿到 shadow root 上问一次，最后才回落到 document 选区。

## Considered Options

- **`Selection.getComposedRanges({shadowRoots})`**（标准）—— 语义正确，但必须先枚举出页面上所有相关的 shadow root 才能调用，而「哪些 root 参与了这次选区」恰恰是我们要求的答案；且它返回 StaticRange，还要自己转回 Range 才能取矩形。
- **`ShadowRoot.getSelection()`**（选中）—— Blink 的遗留 API，但它直接给出 shadow 内部的 Range，矩形拿来即用。宿主元素可以从外层 collapsed Range 的边界节点直接得到，逐层下钻即可支持嵌套 shadow。
- **用鼠标松开的坐标当锚点** —— 不需要 Range，但坐标是视口快照，页面一滚图标就跟丢；且键盘选区没有坐标可用。

## Consequences

- 锚点从「一个 Range 快照」变成「一个能重新求值的函数」（`SelectionCapture.rect`），滚动跟随因此对三条路径一视同仁。
- input/textarea 没有可用的文本矩形，图标锚在**控件本身**的右下角，而不是选中文字的末端 —— 长输入框里图标会离选区较远，这是已知的取舍。
- password 类型的输入框被明确排除，不出划词图标。
- 依赖了一个非标准 API：`ShadowRoot.getSelection()` 一旦被 Blink 移除，shadow DOM 这条路径要改投 `getComposedRanges`。仅面向 Chrome 的扩展，这个风险可接受。
- 回归靠 `pnpm e2e:icon`（真实 Chrome，不需要 api-key）守着，覆盖普通段落、input、textarea、shadow DOM、滚动后、键盘选区。
