import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { fetchImageBytes, postJson } from './http'
import { ProviderError } from './errors'
import type {
  GeneratedImage,
  ImageProvider,
  ImageReference,
  ImageRequest,
  ImageResult,
  ProviderRequestContext
} from './types'

export interface SeedreamConfig {
  baseUrl: string
  apiKey: string
  model: string
}

const MAX_REFERENCE_IMAGES = 14
const MAX_IMAGE_BYTES = 30 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])

function dataUrl(image: ImageReference): string {
  return `data:${image.mimeType};base64,${image.data.toString('base64')}`
}

function validateRequest(request: ImageRequest): void {
  const size = request.size
  if (!/^(1K|2K|3K|4K|\d{2,5}x\d{2,5})$/.test(size)) {
    throw new ProviderError('PROVIDER_INVALID_REQUEST', 'unsupported image size')
  }
  const count = request.count ?? 1
  if (!Number.isInteger(count) || count < 1 || count > 4) {
    throw new ProviderError('PROVIDER_INVALID_REQUEST', 'count must be between 1 and 4')
  }
  const references = request.referenceImages ?? []
  if (references.length > MAX_REFERENCE_IMAGES) {
    throw new ProviderError('PROVIDER_INVALID_REQUEST', 'too many reference images')
  }
  for (const image of references) {
    if (!ALLOWED_MIME.has(image.mimeType) || image.data.length === 0 || image.data.length > MAX_IMAGE_BYTES) {
      throw new ProviderError('PROVIDER_INVALID_REQUEST', 'invalid reference image')
    }
  }
}

function mimeForFormat(format: string | undefined): GeneratedImage['mimeType'] {
  if (format === 'png') return 'image/png'
  if (format === 'jpeg' || format === 'jpg') return 'image/jpeg'
  if (format === 'webp') return 'image/webp'
  throw new ProviderError('PROVIDER_INVALID_RESPONSE', 'unsupported provider image format')
}

async function decodeImage(
  bytes: Buffer,
  claimedType: string | null,
  _context: ProviderRequestContext
): Promise<GeneratedImage> {
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new ProviderError('PROVIDER_INVALID_RESPONSE', 'provider image too large')
  }
  if (
    claimedType &&
    !claimedType.toLowerCase().startsWith('image/') &&
    claimedType.toLowerCase() !== 'application/octet-stream'
  ) {
    throw new ProviderError('PROVIDER_INVALID_RESPONSE', 'provider returned non-image content')
  }
  try {
    const metadata = await sharp(bytes).metadata()
    if (!metadata.width || !metadata.height) throw new Error('missing dimensions')
    return {
      data: bytes,
      mimeType: mimeForFormat(metadata.format),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      width: metadata.width,
      height: metadata.height
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error
    throw new ProviderError('PROVIDER_INVALID_RESPONSE', 'provider image could not be decoded')
  }
}

export class SeedreamImageProvider implements ImageProvider {
  readonly kind = 'image' as const

  constructor(private readonly config: SeedreamConfig) {
    if (!config.baseUrl || !config.apiKey || !config.model) {
      throw new ProviderError('PROVIDER_INVALID_REQUEST', 'Seedream config is incomplete')
    }
  }

  async generate(request: ImageRequest, context: ProviderRequestContext): Promise<ImageResult> {
    validateRequest(request)
    const count = request.count ?? 1
    const references = request.referenceImages ?? []
    const base = this.config.baseUrl.replace(/\/+$/, '')
    const body: Record<string, unknown> = {
      model: this.config.model,
      prompt: request.prompt,
      size: request.size,
      response_format: 'url',
      watermark: false,
      ...(count > 1
        ? {
            sequential_image_generation: 'auto',
            sequential_image_generation_options: { max_images: count }
          }
        : {}),
      ...(request.seed === undefined ? {} : { seed: request.seed }),
      ...(references.length === 0 ? {} : { image: references.map(dataUrl) })
    }

    const { json, headers } = await postJson(
      `${base}/images/generations`,
      this.config.apiKey,
      body,
      context,
      5 * 60_000
    )
    const entries = json.data
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new ProviderError('PROVIDER_INVALID_RESPONSE', 'provider returned no images')
    }

    const images: GeneratedImage[] = []
    for (const entry of entries.slice(0, count)) {
      if (!entry || typeof entry !== 'object') {
        throw new ProviderError('PROVIDER_INVALID_RESPONSE', 'provider image entry invalid')
      }
      const item = entry as { url?: unknown; b64_json?: unknown }
      if (typeof item.url === 'string' && item.url.length > 0) {
        const downloaded = await fetchImageBytes(item.url, context, {
          maxBytes: MAX_IMAGE_BYTES,
          timeoutMs: 60_000
        })
        images.push(await decodeImage(downloaded.bytes, downloaded.contentType, context))
      } else if (typeof item.b64_json === 'string' && item.b64_json.length > 0) {
        images.push(await decodeImage(Buffer.from(item.b64_json, 'base64'), null, context))
      } else {
        throw new ProviderError('PROVIDER_INVALID_RESPONSE', 'provider image entry has no bytes')
      }
    }
    return {
      images,
      model: typeof json.model === 'string' ? json.model : this.config.model,
      providerRequestId: headers.get('x-request-id')
    }
  }
}
