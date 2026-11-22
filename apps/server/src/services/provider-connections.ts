import type Database from 'better-sqlite3'
import {
  SEEDREAM_CAPABILITIES,
  fixedPresetForBaseUrl,
  getFixedProviderPreset,
  newId,
  providerCapabilitiesSchema,
  providerConfigSchema,
  providerModelProfilesSchema,
  type CreateProviderConnectionInput,
  type FixedProviderPresetId,
  type ProviderConfig,
  type ProviderConnectionDto,
  type ProviderModelProfile,
  type ProviderModelSelection,
  type UpdateProviderConnectionInput
} from '@agent2live/contracts'
import { AppError } from '../errors'
import type { Clock } from './clock'
import type { AuditService } from './audit'
import type { RequestIds } from './request-ids'
import { withEvents } from './events-buffer'
import type { EventStore } from '../events/store'

export type { ProviderConnectionDto }

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
  configJson: string
}

function emptyConfig(): ProviderConfig {
  return { schemaVersion: 'provider-config/1', models: [], modelsRefreshedAt: null }
}

function legacyConfig(row: ProviderConnectionRow): ProviderConfig {
  const modelId = row.model ?? (row.adapter === 'mock' ? `mock-${row.kind}` : null)
  if (!modelId) return emptyConfig()
  const capabilities = providerCapabilitiesSchema.parse(JSON.parse(row.capabilities_json))
  return {
    schemaVersion: 'provider-config/1',
    models: [{ id: modelId, name: null, kind: row.kind, adapter: row.adapter, capabilities }],
    modelsRefreshedAt: null
  }
}

function parseConfig(row: ProviderConnectionRow): ProviderConfig {
  try {
    const parsed = providerConfigSchema.safeParse(JSON.parse(row.config_json))
    // 显式空数组表示“已刷新且目录为空”；只有不可解析的旧 config 才回退到单模型。
    if (parsed.success) return parsed.data
  } catch {
    // Fall through to the legacy single-model view.
  }
  return legacyConfig(row)
}

function configJsonFor(models: ProviderModelProfile[] | undefined, refreshedAt: number): string {
  if (models === undefined) return '{}'
  const parsed = providerModelProfilesSchema.parse(models)
  return JSON.stringify({
    schemaVersion: 'provider-config/1',
    models: parsed,
    modelsRefreshedAt: refreshedAt
  })
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

  modelsForRow(row: ProviderConnectionRow): ProviderModelProfile[] {
    return parseConfig(row).models
  }

  resolveModel(
    connectionId: string,
    kind: 'chat' | 'image',
    modelId?: string,
    options: { requireVision?: boolean } = {}
  ): ProviderModelSelection {
    const row = this.row(connectionId)
    if (!row.enabled) throw new AppError('PROVIDER_NOT_CONFIGURED', { connectionId })
    const models = parseConfig(row).models.filter((model) => model.kind === kind)
    const candidates = options.requireVision
      ? models.filter((model) => model.capabilities.chat?.supportsVision === true)
      : models
    const selected = modelId ? candidates.find((model) => model.id === modelId) : candidates[0]
    if (!selected) {
      throw new AppError('PROVIDER_MODEL_NOT_AVAILABLE', {
        connectionId,
        kind,
        ...(modelId === undefined ? {} : { modelId })
      })
    }
    return {
      providerConnectionId: row.id,
      modelId: selected.id,
      adapter: selected.adapter,
      capabilities: selected.capabilities
    }
  }

  private row(id: string): ProviderConnectionRow {
    const row = this.deps.db.prepare('select * from provider_connections where id = ?').get(id) as
      | ProviderConnectionRow
      | undefined
    if (!row) throw new AppError('RESOURCE_NOT_FOUND', { resource: 'providerConnection' })
    return row
  }

  create(input: CreateProviderConnectionInput, ids: RequestIds): ProviderConnectionDto {
    const preset =
      input.presetId && input.presetId !== 'custom' ? getFixedProviderPreset(input.presetId) : null
    const baseUrl = preset ? preset.baseUrl : normalizeProviderBaseUrl(input.adapter, input.baseUrl)
    validateAdapter({ ...input, baseUrl })
    const models = input.models ? providerModelProfilesSchema.parse(input.models) : undefined
    assertModelsMatchConnection(
      models,
      input.adapter,
      preset?.id ?? (input.presetId === 'custom' ? 'custom' : undefined),
      input.kind
    )
    const now = this.deps.clock.now()
    return withEvents(this.deps.db, this.deps.events, (events) => {
      const id = newId('providerConnection')
      this.deps.db
        .prepare(
          `insert into provider_connections
           (id, label, kind, adapter, base_url, model, secret_ref, config_json, capabilities_json, enabled, created_at, updated_at, row_version)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .run(
          id,
          input.label,
          input.kind,
          input.adapter,
          baseUrl ?? null,
          input.model ?? null,
          input.secretRef ?? null,
          configJsonFor(models, now),
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
    const currentConfig = parseConfig(current)
    const models =
      patch.models === undefined ? currentConfig.models : providerModelProfilesSchema.parse(patch.models)
    if (patch.models !== undefined) {
      assertModelsMatchConnection(
        models,
        current.adapter,
        fixedPresetForBaseUrl(current.base_url)?.id ?? (current.base_url ? 'custom' : undefined),
        current.kind
      )
    }
    const now = this.deps.clock.now()
    const configJson = patch.models === undefined ? current.config_json : configJsonFor(models, now)
    const merged: MergedInput = {
      label: patch.label ?? current.label,
      baseUrl: patch.baseUrl === undefined ? current.base_url : patch.baseUrl,
      model: patch.model === undefined ? current.model : patch.model,
      secretRef: patch.secretRef === undefined ? current.secret_ref : patch.secretRef,
      enabled: patch.enabled === undefined ? Boolean(current.enabled) : patch.enabled,
      capabilities:
        patch.capabilities === undefined ? JSON.parse(current.capabilities_json) : patch.capabilities,
      configJson
    }
    validateAdapter({ ...merged, adapter: current.adapter, kind: current.kind })
    merged.baseUrl = normalizeProviderBaseUrl(current.adapter, merged.baseUrl)
    return withEvents(this.deps.db, this.deps.events, (events) => {
      const result = this.deps.db
        .prepare(
          `update provider_connections set label = ?, base_url = ?, model = ?, secret_ref = ?, enabled = ?,
           capabilities_json = ?, config_json = ?, updated_at = ?, row_version = row_version + 1
           where id = ? and row_version = ?`
        )
        .run(
          merged.label,
          merged.baseUrl,
          merged.model,
          merged.secretRef,
          merged.enabled ? 1 : 0,
          JSON.stringify(merged.capabilities),
          merged.configJson,
          now,
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
  const config = parseConfig(row)
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    adapter: row.adapter,
    baseUrl: row.base_url,
    model: row.model,
    enabled: Boolean(row.enabled),
    capabilities: JSON.parse(row.capabilities_json),
    models: config.models,
    modelsRefreshedAt: config.modelsRefreshedAt,
    hasSecret: Boolean(row.secret_ref),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rowVersion: row.row_version
  }
}

function assertModelsMatchConnection(
  models: ProviderModelProfile[] | undefined,
  connectionAdapter: ProviderConnectionRow['adapter'],
  presetId: FixedProviderPresetId | 'custom' | undefined,
  kind: 'chat' | 'image'
): void {
  if (!models || models.length === 0) return
  for (const model of models) {
    if (connectionAdapter === 'mock' && model.adapter !== 'mock') {
      throw new AppError('REQUEST_INVALID', { reason: 'mock connection requires mock models' })
    }
    if (connectionAdapter !== 'mock' && model.adapter === 'mock') {
      throw new AppError('REQUEST_INVALID', { reason: 'real connection cannot use mock models' })
    }
  }
  // 旧 API 创建的单模型连接 / Mock 旧连接没有 presetId，不做固定目录约束。
  if (!presetId) return
  if (presetId === 'deepseek-chat' || presetId === 'zhipu-vision') {
    if (connectionAdapter !== 'openai-compatible') {
      throw new AppError('REQUEST_INVALID', { reason: 'preset requires the openai-compatible adapter' })
    }
    if (models.some((model) => model.kind !== 'chat' || model.adapter !== 'openai-compatible')) {
      throw new AppError('REQUEST_INVALID', { reason: 'preset only supports chat models' })
    }
  }
  if (presetId === 'volcengine-ark') {
    // Ark 目录可能只有 image 模型：此时 legacy 连接用 seedream/image。
    if (connectionAdapter !== 'openai-compatible' && connectionAdapter !== 'seedream') {
      throw new AppError('REQUEST_INVALID', { reason: 'ark connections use chat or image legacy adapters' })
    }
    const invalid = models.some(
      (model) =>
        !(
          (model.kind === 'chat' && model.adapter === 'openai-compatible') ||
          (model.kind === 'image' && model.adapter === 'seedream')
        )
    )
    if (invalid) {
      throw new AppError('REQUEST_INVALID', { reason: 'ark models must be chat or Seedream images' })
    }
  }
  if (presetId === 'custom') {
    if (models.some((model) => model.kind !== kind || model.adapter === 'mock')) {
      throw new AppError('REQUEST_INVALID', { reason: 'custom models must match the connection kind' })
    }
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

const SEEDREAM_IMAGE_ENDPOINT = '/images/generations'

/**
 * Seedream treats baseUrl as the API root and appends /images/generations itself.
 * Provider docs show the full endpoint, so accept that shape by stripping the
 * endpoint users copy, and reject URLs that embed it somewhere we cannot cleanly
 * normalize rather than storing a connection that doubles the path at runtime.
 */
export function normalizeProviderBaseUrl(
  adapter: ProviderConnectionDto['adapter'],
  baseUrl: string | null | undefined
): string | null | undefined {
  if (adapter !== 'seedream' || !baseUrl) return baseUrl
  let normalized = baseUrl.replace(/\/+$/, '')
  while (normalized.endsWith(SEEDREAM_IMAGE_ENDPOINT)) {
    normalized = normalized.slice(0, -SEEDREAM_IMAGE_ENDPOINT.length).replace(/\/+$/, '')
  }
  if (normalized.includes(SEEDREAM_IMAGE_ENDPOINT)) {
    throw new AppError('REQUEST_INVALID', {
      reason: 'seedream baseUrl must be the API root, not an /images/generations endpoint'
    })
  }
  return normalized
}
