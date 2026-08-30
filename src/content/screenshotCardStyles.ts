export const SCREENSHOT_CARD_STYLES = `
:host {
  all: initial;
  --tp-bg: #ffffff;
  --tp-block: #f1f2f4;
  --tp-fg: #1a1a1a;
  --tp-muted: #6b7280;
  --tp-border: rgba(0, 0, 0, 0.08);
  --tp-shadow: 0 8px 32px rgba(0, 0, 0, 0.16);
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
    --tp-danger: #f87171;
  }
}

* {
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
}

.card {
  position: fixed;
  width: min(380px, calc(100vw - 16px));
  height: min(460px, calc(100vh - 16px));
  padding: 12px;
  display: grid;
  grid-template-rows: 28px minmax(0, 132px) auto minmax(44px, 1fr) auto 30px;
  gap: 8px;
  border: 1px solid var(--tp-border);
  border-radius: 8px;
  background: var(--tp-bg);
  color: var(--tp-fg);
  box-shadow: var(--tp-shadow);
  font-size: 14px;
  line-height: 1.6;
  overflow: hidden;
}

.header {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--tp-muted);
  font-size: 12px;
  cursor: move;
  touch-action: none;
  user-select: none;
}

.title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.close {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--tp-muted);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}

.close:hover,
.close:focus-visible {
  background: var(--tp-block);
  color: var(--tp-fg);
}

.preview {
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border-radius: 6px;
  background: var(--tp-block);
  overflow: hidden;
}

.preview img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.badge {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--tp-block);
  color: var(--tp-muted);
  font-size: 12px;
}

.result {
  min-height: 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--tp-block);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  overflow-y: auto;
}

.error {
  max-height: 64px;
  overflow-y: auto;
  color: var(--tp-danger);
  font-size: 12px;
}

.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.actions button {
  min-height: 30px;
  border: 1px solid var(--tp-border);
  border-radius: 6px;
  background: transparent;
  color: var(--tp-muted);
  font-size: 12px;
  padding: 4px 10px;
  cursor: pointer;
}

.actions button:hover,
.actions button:focus-visible {
  color: var(--tp-fg);
  background: var(--tp-block);
}

.dots::after {
  content: '';
  animation: tp-screenshot-dots 1.2s steps(4, end) infinite;
}

@keyframes tp-screenshot-dots {
  0% { content: ''; }
  25% { content: '·'; }
  50% { content: '··'; }
  75% { content: '···'; }
}

.hidden {
  display: none !important;
}
`
