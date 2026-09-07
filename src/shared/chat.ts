import { IMAGE_SYSTEM_PROMPT, IMAGE_USER_PROMPT, SYSTEM_PROMPT } from './prompt'
import type { Settings } from './types'

export type ChatMessage = {
  role: 'system' | 'user'
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >
}

export type ChatRequestBody = {
  model: string
  stream: true
  messages: ChatMessage[]
}

export function textChatBody(settings: Settings, text: string): ChatRequestBody {
  return {
    model: settings.model,
    stream: true,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text },
    ],
  }
}

export function imageChatBody(settings: Settings, imageDataUrl: string): ChatRequestBody {
  return {
    model: settings.imageModel,
    stream: true,
    messages: [
      { role: 'system', content: IMAGE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: IMAGE_USER_PROMPT },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
  }
}
