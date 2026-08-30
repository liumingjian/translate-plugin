# 划词翻译

一个 Chrome 扩展：在网页上选中文字，点击浮现的图标，就地看到译文。
中文译为英语，其余语言一律译为中文简体 —— 语向由模型判定，不做本地语言检测。

翻译走用户自己配置的 OpenAI 协议兼容服务（`/v1/chat/completions`，流式）。

## 开发

```bash
pnpm install
pnpm dev        # 产出 dist/，带 HMR
pnpm build      # 类型检查 + 生产构建
pnpm test       # 纯函数单测
pnpm e2e        # 确定性本地服务：划词与图片导入主链路
pnpm e2e:deterministic # 运行全部确定性 Chrome 验收场景
pnpm e2e:real   # 从主工作区 .env.local 读取凭据，使用固定素材验真实服务
pnpm e2e:icon   # 只验划词图标出不出来，不需要 api-key（需要先 pnpm build）
```

`pnpm e2e:icon` 覆盖各种选区来源：普通段落、input、textarea、shadow DOM、iframe（同源/跨源/srcdoc）、
滚动后、键盘选区。其中 input/textarea 和 shadow DOM 里的选区在 document 上表现为 collapsed，见 ADR 0002；
iframe 的浮层挂在框架自己身上、卡片会被框架视口夹住，见 ADR 0003。

`pnpm e2e` 会构建并加载 `dist/`，用确定性本地 SSE 服务依次验证：未配置 api-key 的提示、
英译中、中译英、疑问句只译不答、缓存命中、超长选区拒绝、深色主题和图片导入。
`pnpm e2e:real` 复用同一套用户流程，只向真实服务发送 `tests/fixtures/` 中的固定素材，
并验证文本模型 `gpt-5.4-mini` 与截图模型 `gpt-5.5`。凭据优先读取 `TP_BASE_URL` / `TP_API_KEY`，
缺少时回退到 `OPENAI_BASE_URL` / `OPENAI_API_KEY`；所有输出均不包含凭据、授权头或图片数据。

驱动 Chrome 有两个坑，改这个脚本前先看清楚：

- Chrome 137 起**静默忽略** `--load-extension`（不报错，扩展就是不加载）。
  必须用 `--enable-unsafe-extension-debugging` 启动，再走 CDP `Extensions.loadUnpacked`，
  该命令只在浏览器级会话上可用，且要求 `pipe: true` 连接。
- puppeteer 默认参数里带 `--disable-extensions`，不用 `ignoreDefaultArgs` 摘掉的话，
  扩展装上了也不会运行 —— 表现为 content script 完全不注入。

加载扩展：`chrome://extensions` → 打开开发者模式 → 「加载已解压的扩展程序」→ 选 `dist/`。

首次使用需要在扩展的设置页填入 `api-key`；`base_url` 默认 `https://api.vipsyfw.com`，
模型默认 `gpt-5.4-mini`。配置只存 `chrome.storage.local`，不同步到账号。

改用其它服务地址时，浏览器会弹窗申请该域名的访问权限 —— 拒绝则配置不会保存。

## 文档

- [`CONTEXT.md`](./CONTEXT.md) —— 术语表
- [`docs/adr/`](./docs/adr/) —— 架构决策记录
