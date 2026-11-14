import sharp, { type Metadata } from 'sharp'

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const MIN_IMAGE_DIMENSION = 64
export const MAX_IMAGE_DIMENSION = 8192
export const MAX_IMAGE_PIXELS = 40_000_000
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export interface ImageInspection {
  mediaType: (typeof ALLOWED_IMAGE_TYPES)[number]
  width: number
  height: number
}

export class ImageValidationError extends Error {
  constructor(readonly reasons: string[]) {
    super(`image validation failed: ${reasons.join(', ')}`)
    this.name = 'ImageValidationError'
  }
}

export async function inspectImage(bytes: Buffer, declaredMime?: string): Promise<ImageInspection> {
  if (bytes.length === 0) throw new ImageValidationError(['empty file'])
  if (bytes.length > MAX_IMAGE_BYTES) throw new ImageValidationError(['file exceeds 20 MiB'])
  let metadata: Metadata
  try {
    metadata = await sharp(bytes, { animated: true, failOn: 'error' }).metadata()
  } catch {
    throw new ImageValidationError(['not a decodable image'])
  }
  if (!metadata.format || !['png', 'jpeg', 'webp'].includes(metadata.format)) {
    throw new ImageValidationError(['unsupported image format'])
  }
  if ((metadata.pages ?? 1) > 1) throw new ImageValidationError(['animated images are not supported'])
  const mediaType =
    metadata.format === 'jpeg' ? 'image/jpeg' : (`image/${metadata.format}` as ImageInspection['mediaType'])
  if (declaredMime && declaredMime !== mediaType) {
    throw new ImageValidationError(['declared MIME does not match content'])
  }
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) {
    throw new ImageValidationError(['image is smaller than 64x64'])
  }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    throw new ImageValidationError(['image exceeds 8192 pixels'])
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    throw new ImageValidationError(['image exceeds 40 megapixels'])
  }
  return { mediaType, width, height }
}
