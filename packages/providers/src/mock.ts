import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { ProviderError, type ProviderErrorCode } from './errors'
import type {
  ChatProvider,
  ChatRequest,
  ChatResult,
  GeneratedImage,
  ImageProvider,
  ImageRequest,
  ImageResult,
  ProviderRequestContext
} from './types'

interface MockOptions {
  delayMs?: number
  failWith?: ProviderErrorCode
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ProviderError('PROVIDER_CANCELLED', 'mock request cancelled'))
      return
    }
    const timer = setTimeout(resolve, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new ProviderError('PROVIDER_CANCELLED', 'mock request cancelled'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    setTimeout(() => signal?.removeEventListener('abort', onAbort), ms + 1)
  })
}

function maybeFail(options: MockOptions): void {
  if (options.failWith) {
    throw new ProviderError(options.failWith, `mock failure: ${options.failWith}`)
  }
}

export function createMockChatProvider(options: MockOptions = {}): ChatProvider {
  return {
    kind: 'chat',
    async generate(request: ChatRequest, context: ProviderRequestContext): Promise<ChatResult> {
      await sleep(options.delayMs ?? 0, context.signal)
      maybeFail(options)
      const last = [...request.messages].reverse().find((message) => message.role === 'user')
      const text =
        typeof last?.content === 'string'
          ? last.content
          : (last?.content.find((part) => part.type === 'text')?.text ?? '')
      return {
        text: `mock:${text}`,
        model: request.model ?? 'mock-chat',
        providerRequestId: `mock-${context.requestId}`,
        usage: { inputTokens: text.length, outputTokens: text.length + 5 }
      }
    }
  }
}

export function createMockImageProvider(options: MockOptions = {}): ImageProvider {
  return {
    kind: 'image',
    async generate(request: ImageRequest, context: ProviderRequestContext): Promise<ImageResult> {
      await sleep(options.delayMs ?? 0, context.signal)
      maybeFail(options)
      const count = Math.max(1, Math.min(request.count ?? 1, 4))
      const images: GeneratedImage[] = []
      for (let index = 0; index < count; index++) {
        const digest = createHash('sha256').update(`${request.prompt}:${index}`).digest()
        const bytes = await sharp({
          create: {
            width: 256,
            height: 256,
            channels: 4,
            background: {
              r: digest[0]!,
              g: digest[1]!,
              b: digest[2]!,
              alpha: 1
            }
          }
        })
          .png()
          .toBuffer()
        images.push({
          data: bytes,
          mimeType: 'image/png',
          sha256: createHash('sha256').update(bytes).digest('hex'),
          width: 256,
          height: 256
        })
      }
      return {
        images,
        model: 'mock-image',
        providerRequestId: `mock-${context.requestId}`
      }
    }
  }
}
