import { createReadStream } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { hashCanonical, newId, type CharacterBackupDto } from '@agent2live/contracts'
import { idsOf, requireIdempotencyKey } from './helpers'
import { BACKUP_FORMAT_VERSION, type BackupService } from '../services/backups'
import type { IdempotencyService } from '../services/idempotency'
import type { JobEngine } from '../jobs/engine'
import { BACKUP_JOB_TYPE } from '../jobs/character-backup'

export function registerBackupRoutes(
  app: FastifyInstance,
  deps: {
    backups: BackupService
    jobs: JobEngine
    idempotency: IdempotencyService
  }
): void {
  app.post('/api/v1/characters/:id/backups', async (request, reply) => {
    const characterId = (request.params as { id: string }).id
    const key = requireIdempotencyKey(request)
    const result = deps.idempotency.run(
      `backup.create:${characterId}`,
      key,
      hashCanonical({ characterId, formatVersion: BACKUP_FORMAT_VERSION }),
      () => {
        deps.backups.requireCharacter(characterId)
        const backupId = newId('backup')
        const job = deps.jobs.enqueue({
          type: BACKUP_JOB_TYPE,
          payload: { backupId, characterId },
          idempotencyKey: `backup.character:${backupId}`
        })
        const body = deps.backups.createRecord({ id: backupId, characterId, jobId: job.id }, idsOf(request))
        return { status: 202, body }
      }
    )
    const body = result.response.body as CharacterBackupDto
    reply
      .status(result.response.status)
      .header('location', `/api/v1/backups/${body.id}`)
      .header('retry-after', '1')
    return body
  })

  app.get('/api/v1/characters/:id/backups', async (request) =>
    deps.backups.list((request.params as { id: string }).id)
  )

  app.get('/api/v1/backups/:backupId', async (request) =>
    deps.backups.get((request.params as { backupId: string }).backupId)
  )

  app.get('/api/v1/backups/:backupId/download', async (request, reply) => {
    const file = await deps.backups.download((request.params as { backupId: string }).backupId)
    reply
      .type('application/zip')
      .header('content-length', String(file.size))
      .header('content-disposition', `attachment; filename="${file.filename}"`)
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
    return reply.send(createReadStream(file.path))
  })
}
