import type { FastifyInstance, FastifyRequest } from 'fastify'
import multipart from '@fastify/multipart'
import { AppError } from '../errors'
import { MAX_IMAGE_BYTES } from '../images/validate'

export const UPLOAD_FILE_LIMIT = MAX_IMAGE_BYTES

export interface UploadedPart {
  fieldName: string
  filename: string
  mimeType: string
  bytes: Buffer
}

export interface MultipartResult {
  fields: Map<string, string>
  files: Map<string, UploadedPart>
}

export async function readMultipart(
  request: FastifyRequest,
  options: { maxFiles: number; maxFileBytes: number; maxFieldBytes?: number }
): Promise<MultipartResult> {
  if (!request.isMultipart()) throw new Error('REQUEST_NOT_MULTIPART')
  const fields = new Map<string, string>()
  const files = new Map<string, UploadedPart>()
  for await (const part of request.parts()) {
    if (part.type === 'field') {
      if (part.fieldname !== 'metadata') throw new Error('UNEXPECTED_FIELD')
      const value = typeof part.value === 'string' ? part.value : JSON.stringify(part.value)
      if (Buffer.byteLength(value) > (options.maxFieldBytes ?? 64 * 1024)) {
        throw new Error('FIELD_TOO_LARGE')
      }
      fields.set(part.fieldname, value)
      continue
    }
    if (part.fieldname === 'metadata') {
      throw new AppError('REQUEST_INVALID', { reason: 'metadata must be a field' })
    }
    if (files.size >= options.maxFiles) throw new Error('TOO_MANY_FILES')
    const bytes = await part.toBuffer()
    if (part.file.truncated) throw new Error('FILE_TOO_LARGE')
    if (bytes.length > options.maxFileBytes) throw new Error('FILE_TOO_LARGE')
    files.set(part.fieldname, {
      fieldName: part.fieldname,
      filename: part.filename,
      mimeType: part.mimetype,
      bytes
    })
  }
  return { fields, files }
}

const CLIENT_MULTIPART_ERRORS: Record<string, string> = {
  FST_FILES_LIMIT: 'too many parts',
  FST_PARTS_LIMIT: 'too many parts',
  FST_FIELDS_LIMIT: 'too many parts',
  FST_PROTO_VIOLATION: 'invalid field name',
  FST_INVALID_MULTIPART_CONTENT_TYPE: 'multipart required',
  FST_INVALID_JSON_FIELD_ERROR: 'invalid multipart field'
}

const READ_MULTIPART_ERRORS: Record<string, string> = {
  REQUEST_NOT_MULTIPART: 'multipart required',
  UNEXPECTED_FIELD: 'unexpected multipart field',
  TOO_MANY_FILES: 'too many files',
  FIELD_TOO_LARGE: 'metadata too large'
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
  if (error instanceof Error) {
    if (error.message === 'FILE_TOO_LARGE') {
      throw new AppError('ASSET_TOO_LARGE', { bytes: UPLOAD_FILE_LIMIT, limit: UPLOAD_FILE_LIMIT })
    }
    const readReason = READ_MULTIPART_ERRORS[error.message]
    if (readReason) throw new AppError('REQUEST_INVALID', { reason: readReason })
  }
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
