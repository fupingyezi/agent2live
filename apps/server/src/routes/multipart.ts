import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { AppError } from '../errors'
import { MAX_IMAGE_BYTES } from '../images/validate'

export const UPLOAD_FILE_LIMIT = MAX_IMAGE_BYTES

const CLIENT_MULTIPART_ERRORS: Record<string, string> = {
  FST_FILES_LIMIT: 'too many parts',
  FST_PARTS_LIMIT: 'too many parts',
  FST_FIELDS_LIMIT: 'too many parts',
  FST_PROTO_VIOLATION: 'invalid field name',
  FST_INVALID_MULTIPART_CONTENT_TYPE: 'multipart required',
  FST_INVALID_JSON_FIELD_ERROR: 'invalid multipart field'
}

export async function registerMultipart(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: {
      fileSize: UPLOAD_FILE_LIMIT,
      files: 15,
      fields: 20,
      parts: 40
    },
    throwFileSizeLimit: true
  })
}

export function mapMultipartError(error: unknown): never {
  if (error instanceof AppError) throw error
  const code = (error as { code?: unknown }).code
  if (code === 'FST_REQ_FILE_TOO_LARGE') {
    throw new AppError('ASSET_TOO_LARGE', { bytes: UPLOAD_FILE_LIMIT, limit: UPLOAD_FILE_LIMIT })
  }
  const reason = typeof code === 'string' ? CLIENT_MULTIPART_ERRORS[code] : undefined
  if (reason) throw new AppError('REQUEST_INVALID', { reason })
  if (typeof code === 'string' && code.startsWith('FST_')) {
    const statusCode = (error as { statusCode?: unknown }).statusCode
    if (typeof statusCode === 'number' && statusCode >= 500) throw error
    throw new AppError('REQUEST_INVALID', { reason: 'invalid multipart request' })
  }
  throw new AppError('REQUEST_INVALID', { reason: 'invalid multipart request' })
}
