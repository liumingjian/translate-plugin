import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest(({ mode }) => ({
  manifest_version: 3,
  name: '划词翻译',
  description: '选中网页文字即可翻译：中文译英文，其余一律译为中文简体。',
  version: '0.1.0',
  minimum_chrome_version: '116',
  permissions: ['storage', 'activeTab'],
  optional_permissions: ['clipboardRead'],
  // 默认翻译服务的域名静态声明；用户自定义 base_url 时走 optional 运行时申请。
  host_permissions: [
    'https://api.vipsyfw.com/*',
    // chrome.action.openPopup() 不会像真实工具栏点击一样授予 activeTab；测试构建
    // captureVisibleTab 只接受 activeTab 或 <all_urls>；测试构建还需访问本地服务。
    // 生产构建不含这两项，仍只依赖用户点击产生的 activeTab 授权。
    ...(mode === 'e2e' ? ['http://127.0.0.1/*', '<all_urls>'] : []),
  ],
  optional_host_permissions: ['https://*/*'],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
      // iframe 里的选区也要出图标；每个框架各挂一套浮层，见 ADR 0003。
      all_frames: true,
      // srcdoc / about:blank 框架（富文本编辑器常用）继承父页面的源，
      // 不显式打开这个开关就注入不进去。
      match_about_blank: true,
    },
  ],
  options_page: 'src/options/index.html',
  action: {
    default_title: '截图翻译',
    default_popup: 'src/popup/index.html',
  },
  commands: {
    'screenshot-translate': {
      suggested_key: { default: 'Alt+Shift+S' },
      description: '启动截图翻译',
    },
  },
}))
