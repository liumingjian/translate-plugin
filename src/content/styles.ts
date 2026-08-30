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
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
}

:host {
  --tp-bg: #ffffff;
  --tp-block: #f1f2f4;
  --tp-fg: #1a1a1a;
  --tp-muted: #6b7280;
  --tp-border: rgba(0, 0, 0, 0.08);
  --tp-shadow: 0 8px 32px rgba(0, 0, 0, 0.16);
  --tp-accent: #2563eb;
  --tp-danger: #dc2626;
}

@media (prefers-color-scheme: dark) {
  :host {
    --tp-bg: #1f2023;
    --tp-block: #2a2c31;
    --tp-fg: #e8eaed;
    --tp-muted: #9aa0a6;
    --tp-border: rgba(255, 255, 255, 0.1);
    --tp-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    --tp-accent: #60a5fa;
    --tp-danger: #f87171;
  }
}

.icon {
  position: fixed;
  width: 28px;
  height: 28px;
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
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
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
  border-radius: 12px;
  background: var(--tp-bg);
  color: var(--tp-fg);
  box-shadow: var(--tp-shadow);
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
  border: none;
  background: transparent;
  color: var(--tp-muted);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
}

.close:hover {
  background: var(--tp-block);
  color: var(--tp-fg);
}

.block {
  padding: 10px 12px;
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

.screenshot-preview {
  display: block;
  width: 100%;
  max-height: 132px;
  object-fit: contain;
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
  border: 1px solid var(--tp-border);
  background: transparent;
  color: var(--tp-muted);
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.action:hover {
  color: var(--tp-fg);
  background: var(--tp-block);
}

.action.primary {
  color: #fff;
  background: var(--tp-accent);
  border-color: transparent;
}

.action.primary:hover {
  opacity: 0.9;
  color: #fff;
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
