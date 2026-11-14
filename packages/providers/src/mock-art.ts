import { createHash } from 'node:crypto'
import sharp from 'sharp'
import type {
  ChatProvider,
  ChatResult,
  GeneratedImage,
  ImageProvider,
  ImageResult,
  ProviderRequestContext
} from './types'
import { ProviderError } from './errors'
import { chatPromptText, structuredMockResponse } from './mock'

const CHAT_JSON = JSON.stringify({
  operations: [
    {
      op: 'replace',
      blockId: 'style.rendering',
      before: '当前风格',
      after: '干净的日系赛璐璐插画，柔和阴影',
      reason: 'mock 建议'
    }
  ],
  warnings: []
})

const ALLOWED = new Set(['512x896', '1024x1792'])

export interface MockArtProviderOptions {
  delayMs?: number
}

async function sleep(context: ProviderRequestContext, delayMs: number): Promise<void> {
  if (context.signal?.aborted) {
    throw new ProviderError('PROVIDER_CANCELLED', 'provider request cancelled')
  }
  if (delayMs <= 0) return
  await new Promise<void>((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined
    const onAbort = (): void => {
      if (timer) clearTimeout(timer)
      reject(new ProviderError('PROVIDER_CANCELLED', 'provider request cancelled'))
    }
    timer = setTimeout(() => {
      context.signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    context.signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function createMockArtProvider(options: MockArtProviderOptions = {}): {
  chat: ChatProvider
  image: ImageProvider
} {
  const delayMs = options.delayMs ?? 0

  const chat: ChatProvider = {
    kind: 'chat',
    async generate(request, context: ProviderRequestContext): Promise<ChatResult> {
      await sleep(context, delayMs)
      const text = chatPromptText(request)
      const structured = structuredMockResponse(text)
      return {
        text: structured ?? CHAT_JSON,
        model: 'mock-art',
        providerRequestId: context.requestId,
        usage: { inputTokens: text.length, outputTokens: structured?.length ?? 1 }
      }
    }
  }

  const image: ImageProvider = {
    kind: 'image',
    async generate(request, context: ProviderRequestContext): Promise<ImageResult> {
      if (!ALLOWED.has(request.size)) {
        throw new ProviderError('PROVIDER_INVALID_REQUEST', 'unsupported image size')
      }
      const count = request.count ?? 1
      if (count < 1 || count > 4) {
        throw new ProviderError('PROVIDER_INVALID_REQUEST', 'count must be between 1 and 4')
      }
      await sleep(context, delayMs)
      // One deterministic color per prompt keeps repeated mock generations byte-identical.
      const seed = createHash('sha256').update(request.prompt).digest()[0]!
      const bytes = await sharp({
        create: {
          width: 512,
          height: 896,
          channels: 4,
          background: { r: seed, g: 120, b: 180, alpha: 1 }
        }
      })
        .png()
        .toBuffer()
      const images: GeneratedImage[] = []
      for (let index = 0; index < count; index += 1) {
        images.push({
          data: bytes,
          mimeType: 'image/png',
          sha256: createHash('sha256').update(bytes).digest('hex'),
          width: 512,
          height: 896
        })
      }
      return { images, model: 'mock-art', providerRequestId: context.requestId }
    }
  }

  return { chat, image }
}
