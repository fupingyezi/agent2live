import type Database from 'better-sqlite3'
import { newId } from '@agent2live/contracts'
import type { Clock } from './clock'
import type { BlobStore } from './blobs'
import { ImageValidationError, MAX_IMAGE_BYTES, inspectImage, type ImageInspection } from '../images/validate'
import { AppError } from '../errors'
import { withEvents } from './events-buffer'
import type { EventStore } from '../events/store'
import type { AuditService } from './audit'

export interface AssetDto {
  id: string
  sha256: string
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
  byteSize: number
  width: number | null
  height: number | null
  createdAt: number
}

interface AssetRow {
  id: string
  sha256: string
  media_type: AssetDto['mediaType']
  byte_size: number
  storage_key: string
  width: number | null
  height: number | null
  metadata_json: string
  created_at: number
}

export interface AssetIngestResult {
  asset: AssetDto
  created: boolean
}

const MAX_ORIGINAL_NAME_LENGTH = 255

export interface AssetServiceDeps {
  db: Database.Database
  blobs: BlobStore
  events: EventStore
  audit: AuditService
  clock: Clock
}

export class AssetService {
  constructor(private readonly deps: AssetServiceDeps) {}

  async ingestUpload(input: {
    bytes: Buffer
    declaredMime?: string
    originalName?: string
    requestId: string
    traceId: string
  }): Promise<AssetIngestResult> {
    return this.ingest({
      ...input,
      originalName: input.originalName ?? null,
      sourceKind: 'upload',
      sourceRef: null,
      modelRef: null,
      license: null,
      consent: null
    })
  }

  async ingestGenerated(input: {
    bytes: Buffer
    mimeType: string
    sourceRef: string
    modelRef: string
    requestId?: string
    traceId?: string
  }): Promise<AssetIngestResult> {
    return this.ingest({
      bytes: input.bytes,
      declaredMime: input.mimeType,
      originalName: null,
      sourceKind: 'ai_generated',
      sourceRef: input.sourceRef,
      modelRef: input.modelRef,
      license: null,
      consent: null,
      requestId: input.requestId ?? 'system',
      traceId: input.traceId ?? 'system'
    })
  }

  private async ingest(input: {
    bytes: Buffer
    declaredMime?: string
    originalName: string | null
    sourceKind: 'upload' | 'ai_generated'
    sourceRef: string | null
    modelRef: string | null
    license: string | null
    consent: string | null
    requestId: string
    traceId: string
  }): Promise<AssetIngestResult> {
    if (input.originalName !== null && input.originalName.length > MAX_ORIGINAL_NAME_LENGTH) {
      throw new AppError('REQUEST_INVALID', {
        reason: `originalName exceeds ${MAX_ORIGINAL_NAME_LENGTH} characters`
      })
    }
    let inspection: ImageInspection
    try {
      inspection = await inspectImage(input.bytes, input.declaredMime)
    } catch (error) {
      if (error instanceof ImageValidationError) {
        if (input.bytes.length > MAX_IMAGE_BYTES) {
          throw new AppError('ASSET_TOO_LARGE', {
            bytes: input.bytes.length,
            limit: MAX_IMAGE_BYTES
          })
        }
        throw new AppError('ASSET_INVALID', { reasons: error.reasons })
      }
      throw error
    }
    const blob = this.deps.blobs.put(input.bytes)
    const existing = this.deps.db.prepare('select * from assets where sha256 = ?').get(blob.sha256) as
      | AssetRow
      | undefined
    if (existing) {
      this.appendProvenance(existing.id, input)
      return { asset: toAssetDto(existing), created: false }
    }
    return withEvents(this.deps.db, this.deps.events, (events) => {
      const id = newId('asset')
      const now = this.deps.clock.now()
      this.deps.db
        .prepare(
          `insert into assets (id, sha256, media_type, byte_size, storage_key, width, height, metadata_json, created_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          blob.sha256,
          inspection.mediaType,
          blob.byteSize,
          blob.storageKey,
          inspection.width,
          inspection.height,
          JSON.stringify({ format: inspection.mediaType }),
          now
        )
      this.appendProvenance(id, input)
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'asset.created',
        targetType: 'asset',
        targetId: id,
        outcome: 'success',
        requestId: input.requestId,
        traceId: input.traceId,
        afterHash: blob.sha256,
        metadata: {
          sourceKind: input.sourceKind,
          mediaType: inspection.mediaType,
          byteSize: blob.byteSize
        }
      })
      events.append({
        type: 'asset.created',
        scopeKind: 'system',
        scopeId: 'system',
        payload: {
          assetId: id,
          sha256: blob.sha256,
          mediaType: inspection.mediaType,
          width: inspection.width,
          height: inspection.height
        },
        requestId: input.requestId,
        traceId: input.traceId
      })
      return {
        created: true,
        asset: {
          id,
          sha256: blob.sha256,
          mediaType: inspection.mediaType,
          byteSize: blob.byteSize,
          width: inspection.width,
          height: inspection.height,
          createdAt: now
        }
      }
    })
  }

  private appendProvenance(
    assetId: string,
    input: {
      originalName: string | null
      sourceKind: string
      sourceRef: string | null
      modelRef: string | null
      license: string | null
      consent: string | null
    }
  ): void {
    this.deps.db
      .prepare(
        `insert into asset_provenance (id, asset_id, source_kind, original_name, source_ref, license, consent, model_ref, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        newId('assetProvenance'),
        assetId,
        input.sourceKind,
        input.originalName,
        input.sourceRef,
        input.license,
        input.consent,
        input.modelRef,
        this.deps.clock.now()
      )
  }

  getAsset(id: string): AssetDto {
    const row = this.deps.db.prepare('select * from assets where id = ?').get(id) as AssetRow | undefined
    if (!row) throw new AppError('ASSET_NOT_FOUND')
    return toAssetDto(row)
  }

  openContent(id: string): { asset: AssetDto; bytes: Buffer } {
    const asset = this.getAsset(id)
    return { asset, bytes: this.deps.blobs.openRead(asset.sha256) }
  }

  listByIds(ids: string[]): AssetDto[] {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(',')
    const rows = this.deps.db
      .prepare(`select * from assets where id in (${placeholders})`)
      .all(...ids) as AssetRow[]
    const byId = new Map(rows.map((row) => [row.id, toAssetDto(row)]))
    return ids.flatMap((id) => {
      const asset = byId.get(id)
      return asset ? [asset] : []
    })
  }
}

function toAssetDto(row: AssetRow): AssetDto {
  return {
    id: row.id,
    sha256: row.sha256,
    mediaType: row.media_type,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    createdAt: row.created_at
  }
}
