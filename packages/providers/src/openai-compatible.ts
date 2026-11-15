import { postJson } from './http'
import { ProviderError } from './errors'
import type { ChatMessage, ChatProvider, ChatRequest, ChatResult, ProviderRequestContext } from './types'

export interface OpenAIChatConfig {
  baseUrl: string
  apiKey: string
  model: string
}

function dataUrl(mimeType: string, data: Buffer): string {
  return `data:${mimeType};base64,${data.toString('base64')}`
}

function toOpenAIMessage(message: ChatMessage): Record<string, unknown> {
  if (typeof message.content === 'string') {
    return { role: message.role, content: message.content }
  }
  return {
    role: message.role,
    content: message.content.map((part) =>
      part.type === 'text'
        ? { type: 'text', text: part.text }
        : { type: 'image_url', image_url: { url: dataUrl(part.mimeType, part.data) } }
    )
  }
}

function textFromContent(content: unknown): string | null {
  if (typeof content === 'string' && content.length > 0) return content
  if (Array.isArray(content)) {
    const parts = content
      .filter(
        (part): part is { type: string; text?: unknown } =>
          Boolean(part) && typeof part === 'object' && (part as { type?: unknown }).type === 'text'
      )
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .filter(Boolean)
    return parts.length > 0 ? parts.join('') : null
  }
  return null
}

export class OpenAIChatProvider implements ChatProvider {
  readonly kind = 'chat' as const

  constructor(private readonly config: OpenAIChatConfig) {
    if (!config.baseUrl || !config.apiKey || !config.model) {
      throw new ProviderError('PROVIDER_INVALID_REQUEST', 'OpenAI-compatible config is incomplete')
    }
  }

  async generate(request: ChatRequest, context: ProviderRequestContext): Promise<ChatResult> {
    const base = this.config.baseUrl.replace(/\/+$/, '')
    const { json, headers } = await postJson(
      `${base}/chat/completions`,
      this.config.apiKey,
      {
        model: request.model ?? this.config.model,
        messages: request.messages.map(toOpenAIMessage),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
        ...(request.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {})
      },
      context
    )

    const choices = json.choices
    const first = Array.isArray(choices)
      ? (choices[0] as { message?: { content?: unknown } } | undefined)
      : undefined
    const text = textFromContent(first?.message?.content)
    if (!text) throw new ProviderError('PROVIDER_INVALID_RESPONSE', 'provider returned no text')

    const usage = json.usage as { prompt_tokens?: unknown; completion_tokens?: unknown } | undefined
    return {
      text,
      model: typeof json.model === 'string' ? json.model : (request.model ?? this.config.model),
      providerRequestId: headers.get('x-request-id'),
      usage: usage
        ? {
            inputTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null,
            outputTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null
          }
        : null
    }
  }
}
