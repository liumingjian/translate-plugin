/**
 * ISO 639-1 码 → 中文语言名。只覆盖常见语言，其余原样显示大写码，
 * 因为语向徽标只是给人看的反馈，不参与任何逻辑判断。
 */
const NAMES: Record<string, string> = {
  ZH: '中文简体',
  EN: '英语',
  JA: '日语',
  KO: '韩语',
  FR: '法语',
  DE: '德语',
  ES: '西班牙语',
  RU: '俄语',
  IT: '意大利语',
  PT: '葡萄牙语',
  AR: '阿拉伯语',
  TH: '泰语',
  VI: '越南语',
  NL: '荷兰语',
  TR: '土耳其语',
  PL: '波兰语',
  ID: '印尼语',
  HI: '印地语',
}

export function langName(code: string): string {
  return NAMES[code.toUpperCase()] ?? code.toUpperCase()
}
