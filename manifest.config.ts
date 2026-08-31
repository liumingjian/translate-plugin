import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: '划词翻译',
  description: '选中网页文字即可翻译：中文译英文，其余一律译为中文简体。',
  version: '0.1.0',
  minimum_chrome_version: '116',
  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },
  permissions: ['storage'],
  // 默认翻译服务的域名静态声明；用户自定义 base_url 时走 optional 运行时申请。
  host_permissions: ['https://api.vipsyfw.com/*'],
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
    default_title: '划词翻译设置',
    default_icon: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
    },
  },
})
