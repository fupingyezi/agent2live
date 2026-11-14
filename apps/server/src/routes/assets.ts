import type { FastifyInstance } from 'fastify'
import type { AssetService } from '../services/assets'
import { AppError } from '../errors'
import { mapMultipartError } from './multipart'

export function registerAssetRoutes(app: FastifyInstance, assets: AssetService): void {
  app.post('/api/v1/assets', async (request, reply) => {
    let part
    try {
      part = await request.file()
    } catch (error) {
      mapMultipartError(error)
    }
    if (!part) throw new AppError('REQUEST_INVALID', { reason: 'file is required' })
    if (part.fieldname !== 'file') {
      throw new AppError('REQUEST_INVALID', { reason: 'expected field file' })
    }
    let bytes: Buffer
    try {
      bytes = await part.toBuffer()
    } catch (error) {
      mapMultipartError(error)
    }
    const result = await assets.ingestUpload({
      bytes,
      declaredMime: part.mimetype,
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
