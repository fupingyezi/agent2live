import type Database from 'better-sqlite3'
import {
  SEEDREAM_CAPABILITIES,
  providerCapabilitiesSchema,
  newId,
  type CreateProviderConnectionInput,
  type UpdateProviderConnectionInput
} from '@agent2live/contracts'
import { AppError } from '../errors'
import type { Clock } from './clock'
import type { AuditService } from './audit'
import type { RequestIds } from './request-ids'
import { withEvents } from './events-buffer'
import type { EventStore } from '../events/store'

export interface ProviderConnectionDto {
  id: string
  label: string
  kind: 'chat' | 'image'
  adapter: 'openai-compatible' | 'seedream' | 'mock'
  baseUrl: string | null
  model: string | null
  enabled: boolean
  capabilities: unknown
  hasSecret: boolean
  createdAt: number
  updatedAt: number
  rowVersion: number
}

export interface ProviderConnectionRow {
  id: string
  label: string
  kind: 'chat' | 'image'
  adapter: ProviderConnectionDto['adapter']
  base_url: string | null
  model: string | null
  secret_ref: string | null
  config_json: string
  capabilities_json: string
  enabled: number
  created_at: number
  updated_at: number
  row_version: number
}

interface MergedInput {
  label: string
  baseUrl: string | null | undefined
  model: string | null | undefined
  secretRef: string | null | undefined
  enabled: boolean
  capabilities: unknown
}

export class ProviderConnectionService {
  constructor(
    private readonly deps: {
      db: Database.Database
      events: EventStore
      audit: AuditService
      clock: Clock
    }
  ) {}

  list(): ProviderConnectionDto[] {
    return (
      this.deps.db
        .prepare('select * from provider_connections order by created_at')
        .all() as ProviderConnectionRow[]
    ).map(toDto)
  }

  get(id: string): ProviderConnectionDto {
    return toDto(this.row(id))
  }

  getRow(id: string): ProviderConnectionRow {
    return this.row(id)
  }

  private row(id: string): ProviderConnectionRow {
    const row = this.deps.db.prepare('select * from provider_connections where id = ?').get(id) as
      | ProviderConnectionRow
      | undefined
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'providerConnection' })
    return row
  }

  create(input: CreateProviderConnectionInput, ids: RequestIds): ProviderConnectionDto {
    validateAdapter(input)
    const now = this.deps.clock.now()
    return withEvents(this.deps.db, this.deps.events, (events) => {
      const id = newId('providerConnection')
      this.deps.db
        .prepare(
          `insert into provider_connections
           (id, label, kind, adapter, base_url, model, secret_ref, config_json, capabilities_json, enabled, created_at, updated_at, row_version)
           values (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, 1)`
        )
        .run(
          id,
          input.label,
          input.kind,
          input.adapter,
          input.baseUrl ?? null,
          input.model ?? null,
          input.secretRef ?? null,
          JSON.stringify(input.capabilities),
          input.enabled ? 1 : 0,
          now,
          now
        )
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'provider.created',
        targetType: 'provider_connection',
        targetId: id,
        outcome: 'success',
        requestId: ids.requestId,
        traceId: ids.traceId,
        metadata: {
          adapter: input.adapter,
          kind: input.kind,
          credentialConfigured: Boolean(input.secretRef)
        }
      })
      events.append({
        type: 'provider.created',
        scopeKind: 'system',
        scopeId: 'system',
        payload: { connectionId: id, kind: input.kind, adapter: input.adapter },
        requestId: ids.requestId,
        traceId: ids.traceId
      })
      return this.get(id)
    })
  }

  update(
    id: string,
    patch: UpdateProviderConnectionInput,
    expectedVersion: number,
    ids: RequestIds
  ): ProviderConnectionDto {
    const current = this.row(id)
    if (current.row_version !== expectedVersion) {
      throw new AppError('ROW_VERSION_CONFLICT', {
        expected: expectedVersion,
        actual: current.row_version
      })
    }
    const merged: MergedInput = {
      label: patch.label ?? current.label,
      baseUrl: patch.baseUrl === undefined ? current.base_url : patch.baseUrl,
      model: patch.model === undefined ? current.model : patch.model,
      secretRef: patch.secretRef === undefined ? current.secret_ref : patch.secretRef,
      enabled: patch.enabled === undefined ? Boolean(current.enabled) : patch.enabled,
      capabilities:
        patch.capabilities === undefined ? JSON.parse(current.capabilities_json) : patch.capabilities
    }
    validateAdapter({ ...merged, adapter: current.adapter, kind: current.kind })
    return withEvents(this.deps.db, this.deps.events, (events) => {
      const result = this.deps.db
        .prepare(
          `update provider_connections set label = ?, base_url = ?, model = ?, secret_ref = ?, enabled = ?,
           capabilities_json = ?, updated_at = ?, row_version = row_version + 1
           where id = ? and row_version = ?`
        )
        .run(
          merged.label,
          merged.baseUrl,
          merged.model,
          merged.secretRef,
          merged.enabled ? 1 : 0,
          JSON.stringify(merged.capabilities),
          this.deps.clock.now(),
          id,
          expectedVersion
        )
      if (result.changes !== 1) {
        throw new AppError('ROW_VERSION_CONFLICT', { expected: expectedVersion })
      }
      this.deps.audit.append({
        actor: { kind: 'local-user' },
        action: 'provider.updated',
        targetType: 'provider_connection',
        targetId: id,
        outcome: 'success',
        requestId: ids.requestId,
        traceId: ids.traceId,
        metadata: { rowVersion: expectedVersion + 1 }
      })
      events.append({
        type: 'provider.updated',
        scopeKind: 'system',
        scopeId: 'system',
        payload: { connectionId: id, rowVersion: expectedVersion + 1 },
        requestId: ids.requestId,
        traceId: ids.traceId
      })
      return this.get(id)
    })
  }
}

function toDto(row: ProviderConnectionRow): ProviderConnectionDto {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    adapter: row.adapter,
    baseUrl: row.base_url,
    model: row.model,
    enabled: Boolean(row.enabled),
    capabilities: JSON.parse(row.capabilities_json),
    hasSecret: Boolean(row.secret_ref),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rowVersion: row.row_version
  }
}

function validateAdapter(input: {
  adapter: ProviderConnectionDto['adapter']
  kind: 'chat' | 'image'
  baseUrl?: string | null | undefined
  model?: string | null | undefined
  secretRef?: string | null | undefined
  enabled: boolean
  capabilities: unknown
}): void {
  const capabilities = providerCapabilitiesSchema.parse(input.capabilities)
  if (input.adapter === 'seedream') {
    if (input.kind !== 'image' || !capabilities.image) {
      throw new AppError('REQUEST_INVALID', { reason: 'seedream requires image capabilities' })
    }
    if (!input.model) throw new AppError('REQUEST_INVALID', { reason: 'seedream model is required' })
    if (capabilities.image.maxReferenceImages > 14) {
      throw new AppError('REQUEST_INVALID', { reason: 'seedream max refs is 14' })
    }
    if (capabilities.image.maxCount > 4) {
      throw new AppError('REQUEST_INVALID', { reason: 'seedream max count is 4' })
    }
    const allowed = new Set(SEEDREAM_CAPABILITIES.image!.sizes)
    if (capabilities.image.sizes.some((size) => !allowed.has(size))) {
      throw new AppError('REQUEST_INVALID', { reason: 'unsupported seedream size' })
    }
  }
  if (input.adapter === 'openai-compatible') {
    if (input.kind !== 'chat' || !capabilities.chat) {
      throw new AppError('REQUEST_INVALID', { reason: 'openai-compatible requires chat capabilities' })
    }
    if (!input.baseUrl) throw new AppError('REQUEST_INVALID', { reason: 'baseUrl is required' })
    if (!input.model) throw new AppError('REQUEST_INVALID', { reason: 'model is required' })
  }
  if (input.adapter === 'mock') {
    if (input.kind === 'image' && !capabilities.image) {
      throw new AppError('REQUEST_INVALID', { reason: 'image capabilities required' })
    }
    if (input.kind === 'chat' && !capabilities.chat) {
      throw new AppError('REQUEST_INVALID', { reason: 'chat capabilities required' })
    }
  }
  if (input.adapter !== 'mock' && input.enabled && !input.secretRef) {
    throw new AppError('PROVIDER_NOT_CONFIGURED', {})
  }
}
