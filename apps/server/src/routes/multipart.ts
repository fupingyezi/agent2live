import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { AppError } from '../errors'

export const UPLOAD_FILE_LIMIT = 20 * 1024 * 1024

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
  const code = (error as { code?: string }).code
  if (code === 'FST_REQ_FILE_TOO_LARGE') {
    throw new AppError('ASSET_TOO_LARGE', { bytes: UPLOAD_FILE_LIMIT, limit: UPLOAD_FILE_LIMIT })
  }
  if (code === 'FST_FILES_LIMIT' || code === 'FST_PARTS_LIMIT') {
    throw new AppError('REQUEST_INVALID', { reason: 'too many parts' })
  }
  if (code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
    throw new AppError('REQUEST_INVALID', { reason: 'multipart required' })
  }
  throw error
}
