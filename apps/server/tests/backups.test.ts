import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { unzipSync } from 'fflate'
import { createTestApp } from './helpers/app'
import { committedPrompt } from './helpers/seed-chain'
import { assertBackupSize } from '../src/services/backups'

describe('character backups', () => {
  it('creates a checksummed character export through a persistent job', async () => {
    const ctx = await createTestApp()
    try {
      const chain = await committedPrompt(ctx, '0001')
      const created = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/characters/${chain.character.id}/backups`,
        headers: { ...ctx.auth, 'idempotency-key': 'backup-key-0001' },
        payload: {}
      })
      expect(created.statusCode).toBe(202)
      const backup = created.json<{
        id: string
        characterId: string
        jobId: string
        status: string
        downloadPath: string | null
        fileSize: number | null
        sha256: string | null
      }>()
      expect(backup.id).toMatch(/^bkp_/)
      expect(backup).toMatchObject({
        characterId: chain.character.id,
        status: 'queued',
        downloadPath: null,
        fileSize: null,
        sha256: null
      })

      const early = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/backups/${backup.id}/download`,
        headers: ctx.auth
      })
      expect(early.statusCode).toBe(409)
      expect(early.json()).toMatchObject({
        error: { code: 'BACKUP_NOT_READY', details: { status: 'queued' } }
      })

      await ctx.services.jobs.tick()
      const done = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/backups/${backup.id}`,
        headers: ctx.auth
      })
      expect(done.statusCode).toBe(200)
      const finished = done.json<{
        status: string
        fileSize: number
        sha256: string
        downloadPath: string
        errorCode: null
      }>()
      expect(finished.status).toBe('succeeded')
      expect(finished.fileSize).toBeGreaterThan(0)
      expect(finished.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(finished.downloadPath).toBe(`/api/v1/backups/${backup.id}/download`)

      const download = await ctx.app.inject({
        method: 'GET',
        url: finished.downloadPath,
        headers: ctx.auth
      })
      expect(download.statusCode).toBe(200)
      expect(download.headers['content-type']).toContain('application/zip')
      expect(download.headers['content-disposition']).toContain(
        `attachment; filename="agent2live-${chain.character.id}-${backup.id}.zip"`
      )
      const zipBytes = download.rawPayload
      expect(createHash('sha256').update(zipBytes).digest('hex')).toBe(finished.sha256)

      const files = unzipSync(new Uint8Array(zipBytes))
      const names = Object.keys(files).sort()
      expect(names).toContain('manifest.json')
      expect(names).toContain('schema/versions.json')
      expect(names).toContain('database/entities.jsonl')
      expect(names).toContain('checksums.sha256')
      expect(
        names.some((name) => name.startsWith('blobs/') && name.split('/')[1] === chain.asset.sha256)
      ).toBe(true)

      const manifest = JSON.parse(Buffer.from(files['manifest.json']!).toString('utf8')) as {
        format: string
        formatVersion: number
        characterId: string
        restoreSupported: boolean
        entityCount: number
        blobCount: number
        counts: Record<string, number>
        blobs: Array<{ sha256: string; byteSize: number }>
        excluded: string[]
      }
      expect(manifest).toMatchObject({
        format: 'agent2live.character-export',
        formatVersion: 1,
        characterId: chain.character.id,
        restoreSupported: false
      })
      expect(manifest.blobCount).toBe(1)
      expect(manifest.blobs[0]!.sha256).toBe(chain.asset.sha256)
      expect(manifest.counts.character).toBe(1)
      expect(manifest.counts.art_project).toBe(1)
      expect(manifest.counts.prompt_version).toBe(1)
      expect(manifest.counts.asset).toBe(1)
      expect(manifest.counts.audit_event).toBeGreaterThan(0)
      expect(manifest.excluded).toEqual(
        expect.arrayContaining([
          'provider_connections',
          'provider_invocations',
          'jobs',
          'job_events',
          'secrets'
        ])
      )
      expect(manifest.entityCount).toBeGreaterThanOrEqual(manifest.counts.character!)

      const entitiesText = Buffer.from(files['database/entities.jsonl']!).toString('utf8')
      const entities = entitiesText
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> })
      expect(entities).toHaveLength(manifest.entityCount)
      expect(
        entities.some((entity) => entity.type === 'character' && entity.data.id === chain.character.id)
      ).toBe(true)
      expect(
        entities.some(
          (entity) => entity.type === 'prompt_version' && entity.data.id === chain.promptVersion.id
        )
      ).toBe(true)
      expect(
        entities.some((entity) => entity.type === 'asset' && entity.data.sha256 === chain.asset.sha256)
      ).toBe(true)
      expect(entities.some((entity) => entity.type === 'asset')).toBe(true)
      for (const entity of entities) {
        if (entity.type === 'asset') expect(entity.data).not.toHaveProperty('storage_key')
      }

      const payloads: string[] = []
      for (const [name, bytes] of Object.entries(files)) {
        if (name.startsWith('blobs/')) continue
        payloads.push(Buffer.from(bytes).toString('utf8'))
      }
      const text = payloads.join('\n')
      expect(text).not.toContain('/Users/')
      expect(text).not.toContain('secret_ref')
      expect(text).not.toContain('sk-')

      const checksumLines = Buffer.from(files['checksums.sha256']!).toString('utf8').trim().split('\n')
      const checksumNames = checksumLines.map((line) => line.slice(66)).sort()
      expect(checksumNames).toEqual(names.filter((name) => name !== 'checksums.sha256').sort())
      for (const line of checksumLines) {
        const digest = line.slice(0, 64)
        const name = line.slice(66)
        expect(createHash('sha256').update(files[name]!).digest('hex')).toBe(digest)
      }

      const replay = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/characters/${chain.character.id}/backups`,
        headers: { ...ctx.auth, 'idempotency-key': 'backup-key-0001' },
        payload: {}
      })
      expect(replay.statusCode).toBe(202)
      expect(replay.json<{ id: string }>().id).toBe(backup.id)

      const list = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/characters/${chain.character.id}/backups`,
        headers: ctx.auth
      })
      expect(list.statusCode).toBe(200)
      expect(list.json<{ items: Array<{ id: string }> }>().items.map((item) => item.id)).toContain(backup.id)
    } finally {
      await ctx.close()
    }
  })

  it('rejects unknown backup targets and tiny size limits', async () => {
    const ctx = await createTestApp()
    try {
      const missing = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/characters/chr_01J0000000000000000000000/backups',
        headers: { ...ctx.auth, 'idempotency-key': 'backup-key-0002' },
        payload: {}
      })
      expect(missing.statusCode).toBe(404)
      const missingGet = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/backups/bkp_01J0000000000000000000000',
        headers: ctx.auth
      })
      expect(missingGet.statusCode).toBe(404)
      expect(() => assertBackupSize(11, 10)).toThrow(expect.objectContaining({ code: 'BACKUP_TOO_LARGE' }))
    } finally {
      await ctx.close()
    }
  })
})
