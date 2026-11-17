import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import archiver from 'archiver'
import type { CharacterBackupDto } from '@agent2live/contracts'
import { AppError } from '../errors'
import type { JobHandlerContext } from '../jobs/types'
import type { Clock } from './clock'
import type { AuditService } from './audit'
import type { EventStore } from '../events/store'
import type { BlobStore } from './blobs'
import type { RequestIds } from './request-ids'
import { withEvents } from './events-buffer'

export const BACKUP_FORMAT_VERSION = 1
export const DEFAULT_BACKUP_MAX_BYTES = 2 * 1024 * 1024 * 1024
const APP_VERSION = '0.1.0'

export function assertBackupSize(bytes: number, limit: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0)
    throw new AppError('SYS_INTERNAL', { reason: 'invalid backup size' })
  if (bytes > limit) throw new AppError('BACKUP_TOO_LARGE', { bytes, limit })
}

interface BackupRow {
  id: string
  character_id: string
  job_id: string
  format_version: number
  relative_path: string | null
  file_size: number | null
  sha256: string | null
  created_at: number
  completed_at: number | null
}

interface BackupViewRow extends BackupRow {
  job_status: CharacterBackupDto['status']
  job_error_json: string | null
}

interface ExportRecord {
  type: string
  data: Record<string, unknown>
}

interface ExportAsset {
  id: string
  sha256: string
  media_type: string
  byte_size: number
  width: number | null
  height: number | null
  created_at: number
}

interface ExportData {
  records: ExportRecord[]
  assets: ExportAsset[]
  migrations: Array<{ version: string; checksum: string; appliedAt: number }>
  counts: Record<string, number>
}

export interface BackupServiceDeps {
  db: Database.Database
  dataDir: string
  blobs: BlobStore
  clock: Clock
  audit: AuditService
  events: EventStore
  maxBytes?: number
}

export class BackupService {
  constructor(private readonly deps: BackupServiceDeps) {}

  requireCharacter(characterId: string): void {
    const row = this.deps.db.prepare('select deleted_at from characters where id = ?').get(characterId) as
      | { deleted_at: number | null }
      | undefined
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'character' })
    if (row.deleted_at !== null) throw new AppError('RESOURCE_DELETED', { resource: 'character' })
  }

  createRecord(
    input: { id: string; characterId: string; jobId: string },
    ctx: RequestIds
  ): CharacterBackupDto {
    this.requireCharacter(input.characterId)
    const now = this.deps.clock.now()
    const backup = withEvents(this.deps.db, this.deps.events, (events) => {
      this.deps.db
        .prepare(
          `insert into backups (id, character_id, job_id, format_version, relative_path, file_size, sha256, created_at, completed_at)
         values (?, ?, ?, ?, null, null, null, ?, null)`
        )
        .run(input.id, input.characterId, input.jobId, BACKUP_FORMAT_VERSION, now)
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'backup.created',
        targetType: 'backup',
        targetId: input.id,
        outcome: 'success',
        requestId: ctx.requestId,
        traceId: ctx.traceId,
        metadata: { characterId: input.characterId, jobId: input.jobId, formatVersion: BACKUP_FORMAT_VERSION }
      })
      events.append({
        type: 'backup.created',
        scopeKind: 'character',
        scopeId: input.characterId,
        payload: { backupId: input.id, jobId: input.jobId },
        requestId: ctx.requestId,
        traceId: ctx.traceId
      })
      return this.get(input.id)
    })
    return backup
  }

  get(backupId: string): CharacterBackupDto {
    return this.toDto(this.viewRow(backupId))
  }

  list(characterId: string): { items: CharacterBackupDto[] } {
    const character = this.deps.db.prepare('select id from characters where id = ?').get(characterId)
    if (!character) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'character' })
    const rows = this.deps.db
      .prepare(
        `select b.*, j.status as job_status, j.error_json as job_error_json
       from backups b join jobs j on j.id = b.job_id
       where b.character_id = ? order by b.created_at desc, b.id desc`
      )
      .all(characterId) as BackupViewRow[]
    return { items: rows.map((row) => this.toDto(row)) }
  }

  async run(
    payload: { backupId: string; characterId: string },
    context: JobHandlerContext<{ backupId: string; characterId: string }>
  ): Promise<{ backupId: string; sha256: string; fileSize: number }> {
    this.throwIfAborted(context.signal)
    const row = this.deps.db.prepare('select * from backups where id = ?').get(payload.backupId) as
      | BackupRow
      | undefined
    if (!row) throw new AppError('SYS_INTERNAL', { reason: 'backup row missing' })
    if (row.character_id !== payload.characterId)
      throw new AppError('SYS_INTERNAL', { reason: 'backup character mismatch' })

    if (row.relative_path && row.sha256 && row.file_size) {
      const existing = this.resolveRelative(row)
      try {
        const info = await stat(existing)
        if (info.size === row.file_size) {
          const digest = createHash('sha256')
            .update(await readFile(existing))
            .digest('hex')
          if (digest === row.sha256) return { backupId: row.id, sha256: row.sha256, fileSize: row.file_size }
        }
      } catch {
        /* rebuild below */
      }
    }

    context.progress(5, 'collecting entities')
    const data = this.collect(payload.characterId)
    const entityBytes = Buffer.from(
      data.records.map((record) => JSON.stringify(record)).join('\n') + '\n',
      'utf8'
    )
    const schemaBytes = Buffer.from(
      JSON.stringify(
        {
          formatVersion: BACKUP_FORMAT_VERSION,
          schemaVersion: data.migrations.at(-1)?.version ?? null,
          migrations: data.migrations
        },
        null,
        2
      ) + '\n',
      'utf8'
    )
    const uncompressed =
      entityBytes.length + schemaBytes.length + data.assets.reduce((sum, asset) => sum + asset.byte_size, 0)
    const maxBytes = this.deps.maxBytes ?? DEFAULT_BACKUP_MAX_BYTES
    assertBackupSize(uncompressed, maxBytes)

    const manifest = {
      format: 'agent2live.character-export',
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion: APP_VERSION,
      schemaVersion: data.migrations.at(-1)?.version ?? null,
      characterId: payload.characterId,
      backupId: row.id,
      createdAt: row.created_at,
      restoreSupported: false,
      modelsIncluded: false,
      entityCount: data.records.length,
      blobCount: data.assets.length,
      blobBytes: data.assets.reduce((sum, asset) => sum + asset.byte_size, 0),
      counts: data.counts,
      blobs: data.assets.map((asset) => ({
        sha256: asset.sha256,
        byteSize: asset.byte_size,
        mediaType: asset.media_type
      })),
      licenses: {
        application: 'GPL-3.0-only',
        cubismCore: 'not included',
        psd2live: 'not included'
      },
      excluded: [
        'provider_connections',
        'provider_invocations',
        'jobs',
        'job_events',
        'secrets',
        'model_artifacts'
      ]
    }
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8')

    const checksums = [
      { name: 'manifest.json', hash: sha256(manifestBytes) },
      { name: 'schema/versions.json', hash: sha256(schemaBytes) },
      { name: 'database/entities.jsonl', hash: sha256(entityBytes) },
      ...data.assets.map((asset) => ({ name: `blobs/${asset.sha256}`, hash: asset.sha256 }))
    ].sort((left, right) => left.name.localeCompare(right.name))
    const checksumBytes = Buffer.from(
      checksums.map((entry) => `${entry.hash}  ${entry.name}\n`).join(''),
      'utf8'
    )

    const finalPath = join(this.deps.dataDir, 'backups', `${row.id}.zip`)
    const tempPath = join(this.deps.dataDir, 'tmp', `backup-${row.id}.zip.part`)
    await mkdir(dirname(finalPath), { recursive: true, mode: 0o700 })
    await mkdir(dirname(tempPath), { recursive: true, mode: 0o700 })
    await rm(tempPath, { force: true })

    let archive: archiver.Archiver | null = null
    const hash = createHash('sha256')
    let written = 0
    try {
      archive = archiver('zip', { zlib: { level: 6 } })
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          written += chunk.length
          if (written > maxBytes) {
            callback(new AppError('BACKUP_TOO_LARGE', { bytes: written, limit: maxBytes }))
            return
          }
          hash.update(chunk)
          callback(null, chunk)
        }
      })
      const output = createWriteStream(tempPath, { flags: 'wx', mode: 0o600 })
      const done = pipeline(archive, meter, output)
      archive.append(manifestBytes, { name: 'manifest.json', mode: 0o600 })
      archive.append(schemaBytes, { name: 'schema/versions.json', mode: 0o600 })
      archive.append(entityBytes, { name: 'database/entities.jsonl', mode: 0o600 })
      for (const [index, asset] of data.assets.entries()) {
        this.throwIfAborted(context.signal)
        this.deps.blobs.verify(asset.sha256)
        const filePath = this.deps.blobs.pathFor(asset.sha256)
        const info = await stat(filePath)
        if (info.size !== asset.byte_size) throw new AppError('BACKUP_FAILED', {})
        archive.file(filePath, { name: `blobs/${asset.sha256}`, mode: 0o600 })
        if (index % 10 === 0)
          context.progress(20 + Math.floor((index / Math.max(1, data.assets.length)) * 60), 'adding blobs')
      }
      archive.append(checksumBytes, { name: 'checksums.sha256', mode: 0o600 })
      const finalized = archive.finalize()
      await Promise.all([finalized, done])
      const digest = hash.digest('hex')
      const size = written
      await rename(tempPath, finalPath)
      const relativePath = relative(this.deps.dataDir, finalPath)
      if (relativePath !== join('backups', `${row.id}.zip`))
        throw new AppError('SYS_INTERNAL', { reason: 'backup path mismatch' })
      const now = this.deps.clock.now()
      withEvents(this.deps.db, this.deps.events, (events) => {
        this.deps.db
          .prepare(
            `update backups set relative_path = ?, file_size = ?, sha256 = ?, completed_at = ? where id = ?`
          )
          .run(relativePath, size, digest, now, row.id)
        this.deps.audit.append({
          actor: { kind: 'system', component: 'backup' },
          action: 'backup.succeeded',
          targetType: 'backup',
          targetId: row.id,
          outcome: 'success',
          requestId: context.jobId,
          traceId: context.jobId,
          metadata: {
            characterId: payload.characterId,
            fileSize: size,
            sha256: digest,
            blobCount: data.assets.length
          }
        })
        events.append({
          type: 'backup.succeeded',
          scopeKind: 'character',
          scopeId: payload.characterId,
          payload: { backupId: row.id, fileSize: size, sha256: digest },
          requestId: context.jobId,
          traceId: context.jobId
        })
      })
      return { backupId: row.id, sha256: digest, fileSize: size }
    } catch (error) {
      try {
        archive?.abort()
      } catch {
        /* ignore archive abort errors */
      }
      await rm(tempPath, { force: true })
      if (error instanceof AppError) throw error
      throw new AppError('BACKUP_FAILED', {})
    }
  }

  async download(backupId: string): Promise<{ path: string; size: number; filename: string }> {
    const row = this.viewRow(backupId)
    if (row.job_status !== 'succeeded' || !row.relative_path || !row.file_size) {
      if (!['succeeded', 'failed', 'cancelled', 'unknown_outcome'].includes(row.job_status)) {
        throw new AppError('BACKUP_NOT_READY', {
          status: row.job_status as 'queued' | 'leased' | 'running' | 'retrying' | 'waiting_user'
        })
      }
      throw new AppError('BACKUP_FAILED', {})
    }
    const path = this.resolveRelative(row)
    try {
      const info = await stat(path)
      if (!info.isFile() || info.size !== row.file_size) throw new Error('size mismatch')
      const digest = createHash('sha256')
        .update(await readFile(path))
        .digest('hex')
      if (digest !== row.sha256) throw new Error('checksum mismatch')
    } catch {
      throw new AppError('BACKUP_FAILED', {})
    }
    return {
      path,
      size: row.file_size,
      filename: `agent2live-${row.character_id}-${row.id}.zip`
    }
  }

  private viewRow(id: string): BackupViewRow {
    const row = this.deps.db
      .prepare(
        `select b.*, j.status as job_status, j.error_json as job_error_json
       from backups b join jobs j on j.id = b.job_id where b.id = ?`
      )
      .get(id) as BackupViewRow | undefined
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'backup' })
    return row
  }

  private toDto(row: BackupViewRow): CharacterBackupDto {
    return {
      id: row.id,
      characterId: row.character_id,
      jobId: row.job_id,
      formatVersion: 1,
      status: row.job_status,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      fileSize: row.file_size,
      sha256: row.sha256,
      downloadPath:
        row.job_status === 'succeeded' && row.relative_path !== null
          ? `/api/v1/backups/${row.id}/download`
          : null,
      errorCode: parseErrorCode(row.job_error_json)
    }
  }

  private collect(characterId: string): ExportData {
    const character = this.deps.db.prepare('select * from characters where id = ?').get(characterId) as
      | Record<string, unknown>
      | undefined
    if (!character) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'character' })

    const queries: Array<{ type: string; sql: string }> = [
      {
        type: 'character_brief_version',
        sql: 'select * from character_brief_versions where character_id = @characterId order by created_at, id'
      },
      {
        type: 'art_project',
        sql: 'select * from art_projects where character_id = @characterId order by created_at, id'
      },
      {
        type: 'project_fork',
        sql: `select f.* from project_forks f join art_projects p on p.id = f.child_project_id
        where p.character_id = @characterId order by f.created_at, f.id`
      },
      {
        type: 'prompt_input_submission',
        sql: `select s.* from prompt_input_submissions s join art_projects p on p.id = s.art_project_id
        where p.character_id = @characterId order by s.created_at, s.id`
      },
      {
        type: 'prompt_draft',
        sql: `select d.* from prompt_drafts d join art_projects p on p.id = d.art_project_id
        where p.character_id = @characterId order by d.created_at, d.id`
      },
      {
        type: 'prompt_version',
        sql: `select v.* from prompt_versions v join art_projects p on p.id = v.art_project_id
        where p.character_id = @characterId order by v.created_at, v.id`
      },
      {
        type: 'prompt_reverse_result',
        sql: `select r.* from prompt_reverse_results r join art_projects p on p.id = r.art_project_id
        where p.character_id = @characterId order by r.created_at, r.id`
      },
      {
        type: 'prompt_suggestion',
        sql: `select s.* from prompt_suggestions s
        where (s.base_version_id is not null and exists (
          select 1 from prompt_versions v join art_projects p on p.id = v.art_project_id
          where v.id = s.base_version_id and p.character_id = @characterId))
        or (s.base_draft_id is not null and exists (
          select 1 from prompt_drafts d join art_projects p on p.id = d.art_project_id
          where d.id = s.base_draft_id and p.character_id = @characterId))
        order by s.created_at, s.id`
      },
      {
        type: 'generation_job',
        sql: `select g.* from generation_jobs g join art_projects p on p.id = g.art_project_id
        where p.character_id = @characterId order by g.created_at, g.id`
      },
      {
        type: 'generation_candidate',
        sql: `select c.* from generation_candidates c
        join generation_jobs g on g.id = c.generation_job_id
        join art_projects p on p.id = g.art_project_id
        where p.character_id = @characterId order by c.created_at, c.id`
      },
      {
        type: 'art_version',
        sql: `select a.* from art_versions a join art_projects p on p.id = a.art_project_id
        where p.character_id = @characterId order by a.created_at, a.id`
      }
    ]

    const records: ExportRecord[] = [{ type: 'character', data: character }]
    const counts: Record<string, number> = { character: 1 }
    for (const query of queries) {
      const rows = this.deps.db.prepare(query.sql).all({ characterId }) as Array<Record<string, unknown>>
      counts[query.type] = rows.length
      for (const row of rows) records.push({ type: query.type, data: row })
    }

    const linkOwners = [
      {
        ownerType: 'prompt_input',
        ids: records
          .filter((record) => record.type === 'prompt_input_submission')
          .map((record) => String(record.data.id))
      },
      {
        ownerType: 'prompt_version',
        ids: records
          .filter((record) => record.type === 'prompt_version')
          .map((record) => String(record.data.id))
      }
    ]
    const assetIds = new Set<string>()
    for (const owner of linkOwners) {
      for (const chunk of chunks(owner.ids, 500)) {
        const placeholders = chunk.map(() => '?').join(',')
        const links = this.deps.db
          .prepare(
            `select * from asset_links where owner_type = ? and owner_id in (${placeholders})
           order by owner_id, sort_order, id`
          )
          .all(owner.ownerType, ...chunk) as Array<Record<string, unknown>>
        for (const link of links) {
          assetIds.add(String(link.asset_id))
          records.push({ type: 'asset_link', data: link })
        }
      }
    }
    counts.asset_link = records.filter((record) => record.type === 'asset_link').length

    for (const record of records) {
      if (record.type === 'generation_candidate') assetIds.add(String(record.data.asset_id))
      if (record.type === 'art_version') assetIds.add(String(record.data.artwork_asset_id))
    }

    const assets: ExportAsset[] = []
    if (assetIds.size > 0) {
      for (const chunk of chunks([...assetIds].sort(), 500)) {
        const placeholders = chunk.map(() => '?').join(',')
        const rows = this.deps.db
          .prepare(
            `select id, sha256, media_type, byte_size, width, height, created_at from assets
           where id in (${placeholders}) order by id`
          )
          .all(...chunk) as ExportAsset[]
        assets.push(...rows)
        const provenance = this.deps.db
          .prepare(
            `select * from asset_provenance where asset_id in (${placeholders}) order by created_at, id`
          )
          .all(...chunk) as Array<Record<string, unknown>>
        for (const row of provenance) records.push({ type: 'asset_provenance', data: row })
      }
    }
    assets.sort((left, right) => left.sha256.localeCompare(right.sha256))
    counts.asset = assets.length
    counts.asset_provenance = records.filter((record) => record.type === 'asset_provenance').length
    for (const asset of assets) {
      records.push({
        type: 'asset',
        data: {
          id: asset.id,
          sha256: asset.sha256,
          media_type: asset.media_type,
          byte_size: asset.byte_size,
          width: asset.width,
          height: asset.height,
          created_at: asset.created_at
        }
      })
    }

    const ids = new Set(records.map((record) => String(record.data.id)).filter((id) => id !== 'undefined'))
    const auditRows = this.deps.db.prepare('select * from audit_events order by seq').all() as Array<
      Record<string, unknown>
    >
    const audits = auditRows.filter((row) => ids.has(String(row.target_id)))
    counts.audit_event = audits.length
    for (const row of audits) records.push({ type: 'audit_event', data: row })

    const migrations = this.deps.db
      .prepare('select version, checksum, applied_at from schema_migrations order by version')
      .all() as Array<{ version: string; checksum: string; applied_at: number }>
    return {
      records,
      assets,
      migrations: migrations.map((row) => ({
        version: row.version,
        checksum: row.checksum,
        appliedAt: row.applied_at
      })),
      counts
    }
  }

  private resolveRelative(row: BackupRow): string {
    if (!row.relative_path || !/^backups\/bkp_[0-9A-HJKMNP-TV-Z]{26}\.zip$/.test(row.relative_path)) {
      throw new AppError('BACKUP_FAILED', {})
    }
    const root = resolve(this.deps.dataDir, 'backups')
    const path = resolve(this.deps.dataDir, row.relative_path)
    if (path !== join(root, `${row.id}.zip`) || !path.startsWith(root + sep)) {
      throw new AppError('BACKUP_FAILED', {})
    }
    return path
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new Error('aborted')
  }
}

function parseErrorCode(json: string | null): string | null {
  if (!json) return null
  try {
    const value = JSON.parse(json) as { code?: unknown }
    return typeof value.code === 'string' ? value.code : null
  } catch {
    return null
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
