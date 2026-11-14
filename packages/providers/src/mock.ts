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

interface MockReverseEnvelope {
  purpose: string
  globalNotes?: string
  requirements: Array<{ id: string; text: string; strength: 'must' | 'prefer' | 'avoid' }>
  materials: Array<{ assetId: string; role: string; note: string; locked: boolean }>
}

interface MockSuggestionEnvelope {
  purpose: string
  intent: string
  blocks: Array<{ id: string; weight: number; locked: boolean }>
}

function isMockSuggestionEnvelope(value: unknown): value is MockSuggestionEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const envelope = value as Record<string, unknown>
  if (typeof envelope.intent !== 'string' || !Array.isArray(envelope.blocks)) return false
  return envelope.blocks.every((block) => {
    if (typeof block !== 'object' || block === null) return false
    const entry = block as Record<string, unknown>
    return (
      typeof entry.id === 'string' &&
      typeof entry.weight === 'number' &&
      Number.isFinite(entry.weight) &&
      typeof entry.locked === 'boolean'
    )
  })
}

function mockSuggestion(envelope: MockSuggestionEnvelope): string {
  const used = new Set(envelope.blocks.map((block) => block.id))
  let id = 'ai.suggestion.mock'
  let suffix = 1
  while (used.has(id)) {
    id = `ai.suggestion.mock.${suffix}`
    suffix += 1
  }
  return JSON.stringify({
    operations: [
      {
        op: 'add',
        block: {
          id,
          category: 'style',
          label: 'AI 建议',
          text: envelope.intent.slice(0, 4000),
          weight: 1,
          locked: false,
          confidence: 0.5,
          evidence: [],
          source: 'ai-suggestion',
          priority: 10,
          requirementRefs: [],
          materialRefs: []
        }
      }
    ],
    warnings: []
  })
}

export function structuredMockResponse(text: string): string | null {
  const marker = text.split('\n').find((line) => line.startsWith('AGENT2LIVE_MOCK_INPUT='))
  if (!marker) return null
  let parsed: { purpose?: unknown }
  try {
    parsed = JSON.parse(
      Buffer.from(marker.slice('AGENT2LIVE_MOCK_INPUT='.length), 'base64url').toString('utf8')
    ) as { purpose?: unknown }
  } catch {
    return null
  }
  if (parsed.purpose === 'prompt.suggestion') {
    return isMockSuggestionEnvelope(parsed) ? mockSuggestion(parsed) : null
  }
  if (parsed.purpose !== 'prompt.reverse') return null
  const envelope = parsed as unknown as MockReverseEnvelope
  const must = envelope.requirements.filter((item) => item.strength === 'must')
  const prefer = envelope.requirements.filter((item) => item.strength === 'prefer')
  const avoid = envelope.requirements.filter((item) => item.strength === 'avoid')
  const materialRefs = envelope.materials.map((item) => item.assetId).slice(0, 20)
  const evidence = materialRefs.map((assetId) => ({ assetId }))
  const base = {
    weight: 1,
    locked: false,
    confidence: 0.8,
    source: 'vision-model' as const,
    priority: 0,
    materialRefs: [] as string[]
  }
  const blocks: Array<Record<string, unknown>> = [
    {
      ...base,
      id: 'subject.identity',
      category: 'subject' as const,
      label: '人物身份',
      text: (must.map((item) => item.text).join('，') || envelope.globalNotes || '角色主体').slice(0, 4000),
      evidence,
      requirementRefs: must.map((item) => item.id).slice(0, 50),
      materialRefs
    }
  ]
  if (prefer.length > 0) {
    blocks.push({
      ...base,
      id: 'style.requested',
      category: 'style' as const,
      label: '风格要求',
      text: prefer
        .map((item) => item.text)
        .join('，')
        .slice(0, 4000),
      evidence: [],
      requirementRefs: prefer.map((item) => item.id).slice(0, 50),
      materialRefs: []
    })
  }
  const negativeBlocks =
    avoid.length > 0
      ? [
          {
            weight: 1,
            locked: false,
            confidence: 0.8,
            source: 'vision-model' as const,
            priority: 0,
            materialRefs: [] as string[],
            evidence: [],
            id: 'negative.avoid',
            category: 'negative' as const,
            label: '避免项',
            text: avoid
              .map((item) => item.text)
              .join('，')
              .slice(0, 4000),
            requirementRefs: avoid.map((item) => item.id).slice(0, 50)
          }
        ]
      : []
  return JSON.stringify({ blocks, negativeBlocks, warnings: [] })
}

export function chatPromptText(request: ChatRequest): string {
  const last = [...request.messages].reverse().find((message) => message.role === 'user')
  if (!last) return ''
  if (typeof last.content === 'string') return last.content
  return last.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

export function createMockChatProvider(options: MockOptions = {}): ChatProvider {
  return {
    kind: 'chat',
    async generate(request: ChatRequest, context: ProviderRequestContext): Promise<ChatResult> {
      await sleep(options.delayMs ?? 0, context.signal)
      maybeFail(options)
      const text = chatPromptText(request)
      const structured = structuredMockResponse(text)
      return {
        text: structured ?? `mock:${text}`,
        model: request.model ?? 'mock-chat',
        providerRequestId: `mock-${context.requestId}`,
        usage: { inputTokens: text.length, outputTokens: (structured ?? text).length + 5 }
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
        const digest = createHash('sha256')
          .update(`${request.prompt}:${index}${request.seed === undefined ? '' : `|${request.seed}`}`)
          .digest()
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
