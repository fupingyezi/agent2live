import { beforeEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { BlobStore } from '../src/services/blobs'
import { AssetService } from '../src/services/assets'
import { createTestApp, createTestDatabase } from './helpers/app'
import { AuditService } from '../src/services/audit'
import type { FakeClock } from '../src/services/clock'
import { assetForm, png, jpeg } from './helpers/files'
import { buildMultipartTestPayload } from './helpers/http'

async function expectCode(fn: () => Promise<unknown> | unknown, code: string): Promise<void> {
  try {
    await fn()
    throw new Error('expected failure')
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code)
  }
}

describe('AssetService', () => {
  let fixture: ReturnType<typeof createTestDatabase>
  let service: AssetService
  let clock: FakeClock

  beforeEach(() => {
    fixture = createTestDatabase()
    clock = fixture.clock
    service = new AssetService({
      db: fixture.db,
      blobs: new BlobStore(fixture.dataDir),
      events: fixture.eventStore,
      audit: new AuditService(fixture.db, clock),
      clock
    })
  })

  it('ingests an image and reports actual dimensions', async () => {
    const bytes = await png(320, 480)
    const result = await service.ingestUpload({
      bytes,
      declaredMime: 'image/png',
      originalName: 'face.png',
      requestId: 'req_asset_1',
      traceId: 'trc_asset_1'
    })
    expect(result.created).toBe(true)
    expect(result.asset).toMatchObject({
      mediaType: 'image/png',
      width: 320,
      height: 480,
      byteSize: bytes.length
    })
    expect(service.getAsset(result.asset.id)).toEqual(result.asset)
    const content = service.openContent(result.asset.id)
    expect(content.asset.sha256).toBe(result.asset.sha256)
    expect(content.bytes).toEqual(bytes)
  })

  it('deduplicates content and records every provenance', async () => {
    const bytes = await png()
    const first = await service.ingestUpload({
      bytes,
      declaredMime: 'image/png',
      originalName: 'a.png',
      requestId: 'r1',
      traceId: 't1'
    })
    const second = await service.ingestUpload({
      bytes,
      declaredMime: 'image/png',
      originalName: 'b.png',
      requestId: 'r2',
      traceId: 't2'
    })
    expect(second.created).toBe(false)
    expect(second.asset.id).toBe(first.asset.id)
    const rows = fixture.db
      .prepare('select original_name from asset_provenance where asset_id = ? order by created_at, rowid')
      .all(first.asset.id)
    expect(rows).toEqual([{ original_name: 'a.png' }, { original_name: 'b.png' }])
    expect(fixture.db.prepare('select count(*) as n from assets').get()).toEqual({ n: 1 })
  })

  it('rejects spoofed, animated, tiny, and oversized images', async () => {
    const jpg = await jpeg()
    await expectCode(
      () =>
        service.ingestUpload({
          bytes: jpg,
          declaredMime: 'image/png',
          originalName: 'spoof.png',
          requestId: 'r',
          traceId: 't'
        }),
      'ASSET_INVALID'
    )
    const tiny = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#fff' } })
      .png()
      .toBuffer()
    await expectCode(
      () =>
        service.ingestUpload({
          bytes: tiny,
          declaredMime: 'image/png',
          originalName: 'tiny.png',
          requestId: 'r',
          traceId: 't'
        }),
      'ASSET_INVALID'
    )
    await expectCode(
      () =>
        service.ingestUpload({
          bytes: Buffer.alloc(20 * 1024 * 1024 + 1),
          declaredMime: 'image/png',
          originalName: 'big.png',
          requestId: 'r',
          traceId: 't'
        }),
      'ASSET_TOO_LARGE'
    )
  })

  it('rejects unknown assets and deleted references', async () => {
    await expectCode(() => service.getAsset('ast_01J00000000000000000000000'), 'ASSET_NOT_FOUND')
  })
})

describe('asset routes', () => {
  it('uploads, reads metadata, and streams content with immutable caching', async () => {
    const ctx = await createTestApp()
    try {
      const bytes = await png(160, 240)
      const form = assetForm(bytes)
      const { payload, contentType } = await buildMultipartTestPayload(form)
      const upload = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/assets',
        headers: { ...ctx.auth, 'content-type': contentType },
        payload
      })
      expect(upload.statusCode).toBe(201)
      const asset = upload.json<{ id: string; width: number; height: number }>()
      expect(asset).toMatchObject({ width: 160, height: 240 })

      const meta = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/assets/${asset.id}`,
        headers: ctx.auth
      })
      expect(meta.statusCode).toBe(200)
      expect(meta.json()).not.toHaveProperty('storageKey')

      const content = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/assets/${asset.id}/content`,
        headers: ctx.auth
      })
      expect(content.statusCode).toBe(200)
      expect(content.headers['content-type']).toBe('image/png')
      expect(content.headers['cache-control']).toContain('immutable')
      expect(content.rawPayload.equals(bytes)).toBe(true)
      expect(content.headers.etag).toMatch(/^"[0-9a-f]{64}"$/)

      const second = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/assets',
        headers: { ...ctx.auth, 'content-type': contentType },
        payload
      })
      expect(second.statusCode).toBe(200)
      expect(second.json()).toMatchObject({ id: asset.id })
    } finally {
      await ctx.close()
    }
  })

  it('requires auth and rejects spoofed files', async () => {
    const ctx = await createTestApp()
    try {
      const jpg = await jpeg(160, 240)
      const form = assetForm(jpg, 'fake.png', 'image/png')
      const { payload, contentType } = await buildMultipartTestPayload(form)
      const unauth = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/assets',
        headers: { 'content-type': contentType },
        payload
      })
      expect(unauth.statusCode).toBe(401)
      const spoofed = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/assets',
        headers: { ...ctx.auth, 'content-type': contentType },
        payload
      })
      expect(spoofed.statusCode).toBe(422)
      expect(spoofed.json()).toMatchObject({ error: { code: 'ASSET_INVALID' } })
    } finally {
      await ctx.close()
    }
  })
})
