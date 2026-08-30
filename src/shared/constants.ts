/** 选区硬上限。超过直接拒绝翻译，而不是截断出半截译文。 */
export const MAX_SELECTION_LENGTH = 3000

/** 译文缓存条数上限（service worker 存活期内有效）。 */
export const CACHE_CAPACITY = 100

export const DEFAULT_BASE_URL = 'https://api.vipsyfw.com'
export const DEFAULT_MODEL = 'gpt-5.4-mini'
export const DEFAULT_IMAGE_MODEL = 'gpt-5.5'

/** 导入图片的原始文件上限；裁剪后的请求体还会按像素数进一步缩放。 */
export const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024

export const MIN_IMAGE_SELECTION_SIZE = 16
export const MAX_IMAGE_EDGE = 4096
export const MAX_IMAGE_PIXELS = 10_000_000

/** 语向徽标在无法从响应中解出语向时的兜底文案。 */
export const UNKNOWN_LANG_LABEL = '自动'
