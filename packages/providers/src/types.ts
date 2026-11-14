export type ChatRole = 'system' | 'user' | 'assistant'

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; data: Buffer }

export interface ChatMessage {
  role: ChatRole
  content: string | ChatContentPart[]
}

export interface ChatRequest {
  messages: ChatMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
}

export interface ChatUsage {
  inputTokens: number | null
  outputTokens: number | null
}

export interface ChatResult {
  text: string
  model: string
  providerRequestId: string | null
  usage: ChatUsage | null
}

export interface ImageReference {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  data: Buffer
  role?: string
  weight?: number
  note?: string
}

export interface ImageRequest {
  prompt: string
  negativePrompt?: string
  referenceImages?: ImageReference[]
  count?: number
  size: string
  seed?: number
}

export interface GeneratedImage {
  data: Buffer
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  sha256: string
  width: number
  height: number
}

export interface ImageResult {
  images: GeneratedImage[]
  model: string
  providerRequestId: string | null
}

export interface ProviderRequestContext {
  requestId: string
  signal?: AbortSignal
  timeoutMs?: number
}

export interface ChatProvider {
  readonly kind: 'chat'
  generate(request: ChatRequest, context: ProviderRequestContext): Promise<ChatResult>
}

export interface ImageProvider {
  readonly kind: 'image'
  generate(request: ImageRequest, context: ProviderRequestContext): Promise<ImageResult>
}
