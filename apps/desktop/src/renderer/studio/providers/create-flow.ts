import type { ProviderCapabilities } from '@agent2live/contracts'
import type { ProviderConnectionDto } from '../api/types'
import { getProviderPreset, type ProviderFormValues } from './presets'

export type ProviderConnectionRecord = ProviderConnectionDto

export interface CreateProviderInput {
  label: string
  kind: 'chat' | 'image'
  adapter: 'openai-compatible' | 'seedream' | 'mock'
  baseUrl?: string
  model?: string
  enabled: boolean
  capabilities: ProviderCapabilities
}

export interface UpdateProviderInput {
  label?: string
  baseUrl?: string | null
  model?: string | null
  secretRef?: string
  enabled?: boolean
}

export interface ProviderFlowPort {
  create(input: CreateProviderInput): Promise<ProviderConnectionRecord>
  update(id: string, patch: UpdateProviderInput, rowVersion: number): Promise<ProviderConnectionRecord>
  get(id: string): Promise<ProviderConnectionRecord>
  storeSecret(input: { label: string; value: string }): Promise<{ secretRef: string }>
}

export type ProviderFormField = 'label' | 'baseUrl' | 'model' | 'apiKey'

export class ProviderFormError extends Error {
  readonly fields: Partial<Record<ProviderFormField, string>>

  constructor(fields: Partial<Record<ProviderFormField, string>>) {
    super('连接表单校验失败')
    this.name = 'ProviderFormError'
    this.fields = fields
  }
}

export class ProviderActivationError extends Error {
  readonly providerId: string

  constructor(providerId: string, cause: unknown) {
    super('连接已创建，但启用失败。请检查密钥后重试。')
    this.name = 'ProviderActivationError'
    this.providerId = providerId
    this.cause = cause
  }
}

function normalize(values: ProviderFormValues): {
  label: string
  baseUrl: string
  model: string
  apiKey: string
} {
  return {
    label: values.label.trim(),
    baseUrl: values.baseUrl.trim(),
    model: values.model.trim(),
    apiKey: values.apiKey.trim()
  }
}

function validateCommon(values: ProviderFormValues): {
  label: string
  baseUrl: string
  model: string
  apiKey: string
} {
  const normalized = normalize(values)
  const fields: Partial<Record<ProviderFormField, string>> = {}
  if (!normalized.label) fields.label = '请输入连接名称。'
  if (normalized.label.length > 80) fields.label = '连接名称不能超过 80 个字符。'
  if (normalized.model.length > 200) fields.model = '模型名不能超过 200 个字符。'

  const preset = getProviderPreset(values.presetId)
  if (preset.requiresSecret) {
    if (!normalized.baseUrl) {
      fields.baseUrl = '请输入 API Base URL。'
    } else {
      try {
        const url = new URL(normalized.baseUrl)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          fields.baseUrl = '仅支持 http 或 https 地址。'
        }
      } catch {
        fields.baseUrl = '请输入有效的 URL。'
      }
    }
    if (!normalized.model) fields.model = '请输入模型名。'
  }
  if (Object.keys(fields).length > 0) throw new ProviderFormError(fields)
  return normalized
}

export function buildCreateInput(values: ProviderFormValues): CreateProviderInput {
  const preset = getProviderPreset(values.presetId)
  const normalized = validateCommon(values)
  const fields: Partial<Record<ProviderFormField, string>> = {}
  if (preset.requiresSecret && !normalized.apiKey) fields.apiKey = '请输入 API Key。'
  if (Object.keys(fields).length > 0) throw new ProviderFormError(fields)

  return {
    label: normalized.label,
    kind: preset.kind,
    adapter: preset.adapter,
    enabled: !preset.requiresSecret,
    capabilities: preset.capabilities,
    ...(preset.requiresSecret || normalized.baseUrl ? { baseUrl: normalized.baseUrl } : {}),
    ...(preset.requiresSecret || normalized.model ? { model: normalized.model } : {})
  }
}

export async function createProviderFlow(
  port: ProviderFlowPort,
  values: ProviderFormValues
): Promise<ProviderConnectionRecord> {
  const preset = getProviderPreset(values.presetId)
  const created = await port.create(buildCreateInput(values))
  if (!preset.requiresSecret) return created

  const value = values.apiKey.trim()
  const { secretRef } = await port.storeSecret({
    label: `provider-secret:${created.id}`,
    value
  })

  try {
    return await port.update(created.id, { secretRef, enabled: true }, created.rowVersion)
  } catch (error) {
    const latest = await port.get(created.id).catch(() => null)
    if (latest?.enabled && latest.hasSecret) return latest
    throw new ProviderActivationError(created.id, error)
  }
}

export async function updateProviderFlow(
  port: ProviderFlowPort,
  current: ProviderConnectionRecord,
  values: ProviderFormValues
): Promise<ProviderConnectionRecord> {
  const preset = getProviderPreset(values.presetId)
  const normalized = validateCommon(values)
  const real = current.adapter !== 'mock'
  const fields: Partial<Record<ProviderFormField, string>> = {}

  if (real && values.enabled && !current.hasSecret && !normalized.apiKey) {
    fields.apiKey = '启用真实连接需要现有密钥或新密钥。'
  }
  if (Object.keys(fields).length > 0) throw new ProviderFormError(fields)

  const patch: UpdateProviderInput = {}
  if (normalized.label !== current.label) patch.label = normalized.label
  if (normalized.baseUrl !== (current.baseUrl ?? '')) patch.baseUrl = normalized.baseUrl || null
  if (normalized.model !== (current.model ?? '')) patch.model = normalized.model || null
  if (values.enabled !== current.enabled) patch.enabled = values.enabled
  if (normalized.apiKey) {
    const { secretRef } = await port.storeSecret({
      label: `provider-secret:${current.id}`,
      value: normalized.apiKey
    })
    patch.secretRef = secretRef
  }

  if (Object.keys(patch).length === 0) return current
  return port.update(current.id, patch, current.rowVersion)
}
