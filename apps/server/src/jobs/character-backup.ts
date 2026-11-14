import { z } from 'zod'
import type { JobDefinition } from './types'
import type { BackupService } from '../services/backups'

export const BACKUP_JOB_TYPE = 'backup.character'
const payloadSchema = z
  .object({
    backupId: z.string().regex(/^bkp_[0-9A-HJKMNP-TV-Z]{26}$/),
    characterId: z.string().min(1).max(64)
  })
  .strict()

export function createCharacterBackupJob(
  service: BackupService
): JobDefinition<z.infer<typeof payloadSchema>> {
  return {
    type: BACKUP_JOB_TYPE,
    payloadSchema,
    sideEffect: 'idempotent',
    maxAttempts: 2,
    timeoutMs: 180_000,
    run: (context) => service.run(context.payload, context)
  }
}
