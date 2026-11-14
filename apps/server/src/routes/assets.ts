import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { AssetService } from '../services/assets'
import { AppError } from '../errors'
import { mapMultipartError, readMultipart, UPLOAD_FILE_LIMIT, type MultipartResult } from './multipart'

async function readAssetMultipart(request: FastifyRequest): Promise<MultipartResult> {
  try {
    return await readMultipart(request, { maxFiles: 1, maxFileBytes: UPLOAD_FILE_LIMIT })
  } catch (error) {
    mapMultipartError(error)
  }
}

export function registerAssetRoutes(app: FastifyInstance, assets: AssetService): void {
  app.post('/api/v1/assets', async (request, reply) => {
    const parsed = await readAssetMultipart(request)
    if (parsed.files.size === 0) throw new AppError('REQUEST_INVALID', { reason: 'file is required' })
    const part = parsed.files.get('file')
    if (!part) throw new AppError('REQUEST_INVALID', { reason: 'expected field file' })
    const result = await assets.ingestUpload({
      bytes: part.bytes,
      declaredMime: part.mimeType,
      originalName: part.filename,
      requestId: request.id,
      traceId: request.traceId
    })
    reply.status(result.created ? 201 : 200)
    reply.header('etag', `"${result.asset.sha256}"`)
    return result.asset
  })

  app.get('/api/v1/assets/:id', async (request) => {
    const { id } = request.params as { id: string }
    return assets.getAsset(id)
  })

  app.get('/api/v1/assets/:id/content', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { asset, bytes } = assets.openContent(id)
    reply
      .header('content-type', asset.mediaType)
      .header('content-length', String(bytes.length))
      .header('etag', `"${asset.sha256}"`)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('content-disposition', `inline; filename="${id}"`)
    return reply.send(bytes)
  })
}
