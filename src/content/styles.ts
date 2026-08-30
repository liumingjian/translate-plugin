/**
 * 浮层样式。整体挂在 Shadow DOM 里，宿主元素做 `all: initial` 重置，
 * 保证既不被宿主页面的样式污染，也不污染宿主页面。
 */
export const STYLES = `
:host {
  all: initial;
}

* {
  box-sizing: border-box;
  font-family: "SF Pro Text", system-ui, -apple-system, BlinkMacSystemFont,
    "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  letter-spacing: 0;
}

:host {
  --tp-bg: #ffffff;
  --tp-block: #fafafc;
  --tp-fg: #1d1d1f;
  --tp-muted: #7a7a7a;
  --tp-border: #e0e0e0;
  --tp-accent: #0066cc;
  --tp-primary: #0066cc;
  --tp-primary-hover: #0071e3;
  --tp-focus: #0071e3;
  --tp-on-primary: #ffffff;
  --tp-danger: #c62828;
}

@media (prefers-color-scheme: dark) {
  :host {
    --tp-bg: #272729;
    --tp-block: #2a2a2c;
    --tp-fg: #ffffff;
    --tp-muted: #cccccc;
    --tp-border: #454547;
    --tp-accent: #2997ff;
    --tp-primary: #0066cc;
    --tp-primary-hover: #0071e3;
    --tp-focus: #0071e3;
    --tp-on-primary: #ffffff;
    --tp-danger: #ff8a80;
  }
}

.icon {
  position: fixed;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--tp-border);
  border-radius: 50%;
  background: var(--tp-bg);
  color: var(--tp-fg);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  padding: 0;
}

.icon:hover {
  background: var(--tp-block);
}

.card {
  position: fixed;
  width: 380px;
  max-width: calc(100vw - 16px);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--tp-border);
  border-radius: 8px;
  background: var(--tp-bg);
  color: var(--tp-fg);
  font-size: 14px;
  line-height: 1.6;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--tp-muted);
  font-size: 12px;
}

.close {
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--tp-muted);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}

.close:hover {
  background: var(--tp-block);
  color: var(--tp-fg);
}

.block {
  padding: 10px 12px;
  border: 1px solid var(--tp-border);
  border-radius: 8px;
  background: var(--tp-block);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 160px;
  overflow-y: auto;
}

.source {
  color: var(--tp-muted);
}

.badge {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 6px;
  border-radius: 8px;
  background: var(--tp-block);
  color: var(--tp-muted);
  font-size: 12px;
}

.result {
  min-height: 44px;
}

.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.action {
  min-height: 44px;
  border: 1px solid var(--tp-border);
  background: transparent;
  color: var(--tp-accent);
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 9999px;
  cursor: pointer;
}

.action:hover {
  background: var(--tp-block);
}

.action.primary {
  color: var(--tp-on-primary);
  background: var(--tp-primary);
  border-color: var(--tp-primary);
}

.action.primary:hover {
  background: var(--tp-primary-hover);
  border-color: var(--tp-primary-hover);
  color: var(--tp-on-primary);
}

button:active:not(:disabled) {
  transform: scale(0.95);
}

button:focus-visible {
  outline: 3px solid var(--tp-focus);
  outline-offset: 2px;
}

.error {
  color: var(--tp-danger);
}

.detail {
  color: var(--tp-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.dots::after {
  content: '';
  animation: tp-dots 1.2s steps(4, end) infinite;
}

@keyframes tp-dots {
  0% { content: ''; }
  25% { content: '·'; }
  50% { content: '··'; }
  75% { content: '···'; }
}

.hidden {
  display: none !important;
}
`
