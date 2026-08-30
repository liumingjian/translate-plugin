export const SCREENSHOT_CARD_STYLES = `
:host {
  all: initial;
  --tp-bg: #ffffff;
  --tp-block: #fafafc;
  --tp-fg: #1d1d1f;
  --tp-muted: #7a7a7a;
  --tp-border: #e0e0e0;
  --tp-accent: #0066cc;
  --tp-primary: #0066cc;
  --tp-danger: #c62828;
  --tp-focus: #0066cc;
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
    --tp-danger: #ff8a80;
    --tp-focus: #2997ff;
  }
}

* {
  box-sizing: border-box;
  font-family: "SF Pro Text", system-ui, -apple-system, BlinkMacSystemFont,
    "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  letter-spacing: 0;
}

.card {
  position: fixed;
  width: min(380px, calc(100vw - 16px));
  height: min(460px, calc(100vh - 16px));
  padding: 12px;
  display: grid;
  grid-template-rows: 28px minmax(64px, 132px) auto minmax(44px, 1fr) auto auto;
  gap: 8px;
  overflow-y: auto;
  border: 1px solid var(--tp-border);
  border-radius: 8px;
  background: var(--tp-bg);
  color: var(--tp-fg);
  box-shadow: 0 8px 28px rgba(0, 0, 0, .18);
  font-size: 14px;
  line-height: 1.5;
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

.title { overflow: hidden; color: var(--tp-fg); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.close {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--tp-muted);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.close:hover,
.close:focus-visible { background: var(--tp-block); color: var(--tp-fg); }
button:focus-visible { outline: 3px solid var(--tp-focus); outline-offset: 2px; }

.preview {
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  overflow: hidden;
  border: 1px solid var(--tp-border);
  border-radius: 8px;
  background: var(--tp-block);
}

.preview img { display: block; width: 100%; height: 100%; object-fit: contain; }
.badge { display: flex; align-items: center; justify-content: center; min-height: 30px; padding: 4px 8px; border-radius: 8px; background: var(--tp-block); color: var(--tp-muted); font-size: 12px; }
.result { min-height: 0; padding: 12px; overflow-y: auto; border: 1px solid var(--tp-border); border-radius: 8px; background: var(--tp-block); white-space: pre-wrap; overflow-wrap: anywhere; }
.error { max-height: 64px; overflow-y: auto; color: var(--tp-danger); font-size: 12px; }

.actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-wrap: wrap; }
.actions button {
  min-height: 32px;
  padding: 5px 12px;
  border: 1px solid var(--tp-border);
  border-radius: 9999px;
  background: transparent;
  color: var(--tp-accent);
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}

.actions button:hover,
.actions button:focus-visible { background: var(--tp-block); }
.actions button.primary { border-color: var(--tp-primary); background: var(--tp-primary); color: #ffffff; }
.actions button.primary:hover,
.actions button.primary:focus-visible { border-color: #0071e3; background: #0071e3; }

.dots::after { content: ''; animation: tp-screenshot-dots 1.2s steps(4, end) infinite; }
@keyframes tp-screenshot-dots {
  0% { content: ''; }
  25% { content: '·'; }
  50% { content: '··'; }
  75% { content: '···'; }
}

.hidden { display: none !important; }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

@media (max-width: 340px) {
  .card { padding: 10px; }
  .actions { align-items: stretch; }
  .actions button { flex: 1 1 auto; }
}

@media (max-height: 360px) {
  .card { grid-template-rows: 28px 56px auto minmax(44px, 1fr) auto auto; }
}

@media (prefers-reduced-motion: reduce) {
  .dots::after { animation: none; content: '…'; }
}
`
