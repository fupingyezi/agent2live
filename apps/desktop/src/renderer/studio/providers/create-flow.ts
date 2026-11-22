import type { CreateProviderConnectionInput, UpdateProviderConnectionInput } from '@agent2live/contracts/api'
import { providerModelProfileSchema, type ProviderModelProfile } from '@agent2live/contracts'
import type { ProviderConnectionDto } from '@studio/api'
import { getFixedProviderPreset, manualModelProfile, type ProviderFormValues } from './presets'

export type ProviderConnectionRecord = ProviderConnectionDto
export type CreateProviderInput = CreateProviderConnectionInput
export type UpdateProviderInput = UpdateProviderConnectionInput

export interface ProviderFlowPort {
  create(input: CreateProviderInput): Promise<ProviderConnectionRecord>
  update(id: string, patch: UpdateProviderInput, rowVersion: number): Promise<ProviderConnectionRecord>
  get(id: string): Promise<ProviderConnectionRecord>
  storeSecret(input: { label: string; value: string }): Promise<{ secretRef: string }>
  deleteSecret(secretRef: string): Promise<void>
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

export function validateProviderBaseUrl(value: string): string | null {
  if (!value) return '请输入 API Base URL。'
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '仅支持 http 或 https 地址。'
    return null
  } catch {
    return '请输入有效的 URL。'
  }
}

function resolveProfiles(values: ProviderFormValues, models: ProviderModelProfile[]): ProviderModelProfile[] {
  if (models.length > 0) return models.map((model) => providerModelProfileSchema.parse(model))
  if (values.presetId !== 'custom') {
    throw new ProviderFormError({ model: '请先获取可用模型。' })
  }
  if (!values.manualModel.trim()) {
    throw new ProviderFormError({ model: '请输入模型名，或先获取可用模型。' })
  }
  return [providerModelProfileSchema.parse(manualModelProfile(values))]
}

function representativeProfile(
  values: ProviderFormValues,
  profiles: ProviderModelProfile[]
): ProviderModelProfile {
  const requested = profiles.find((model) => model.id === values.manualModel.trim())
  if (values.presetId === 'custom' && requested) return requested
  return (
    profiles.find((model) => model.kind === values.kind) ??
    profiles.find((model) => model.kind === 'chat') ??
    profiles[0]!
  )
}

export function buildCreateInput(
  values: ProviderFormValues,
  models: ProviderModelProfile[]
): CreateProviderInput {
  const label = values.label.trim()
  const fields: Partial<Record<ProviderFormField, string>> = {}
  if (!label) fields.label = '请输入连接名称。'
  if (label.length > 80) fields.label = '连接名称不能超过 80 个字符。'
  if (!values.apiKey.trim()) fields.apiKey = '请输入 API Key。'
  if (values.presetId === 'custom') {
    const baseError = validateProviderBaseUrl(values.baseUrl.trim())
    if (baseError) fields.baseUrl = baseError
  }
  if (Object.keys(fields).length > 0) throw new ProviderFormError(fields)

  const profiles = resolveProfiles(values, models)
  const primary = representativeProfile(values, profiles)
  const baseUrl =
    values.presetId === 'custom' ? values.baseUrl.trim() : getFixedProviderPreset(values.presetId)!.baseUrl

  return {
    label,
    kind: primary.kind,
    adapter: primary.adapter,
    baseUrl,
    model: primary.id,
    capabilities: primary.capabilities,
    presetId: values.presetId,
    models: profiles,
    enabled: false
  }
}

export async function createProviderFlow(
  port: ProviderFlowPort,
  values: ProviderFormValues,
  models: ProviderModelProfile[],
  draftSecretRef: string | null
): Promise<ProviderConnectionRecord> {
  const created = await port.create(buildCreateInput(values, models))
  try {
    const { secretRef } = await port.storeSecret({
      label: `provider-secret:${created.id}`,
      value: values.apiKey.trim()
    })
    const activated = await port.update(created.id, { secretRef, enabled: true }, created.rowVersion)
    if (draftSecretRef) await port.deleteSecret(draftSecretRef).catch(() => undefined)
    return activated
  } catch (error) {
    const latest = await port.get(created.id).catch(() => null)
    if (latest?.enabled && latest.hasSecret) {
      if (draftSecretRef) await port.deleteSecret(draftSecretRef).catch(() => undefined)
      return latest
    }
    throw new ProviderActivationError(created.id, error)
  }
}

export interface UpdateProviderOptions {
  models?: ProviderModelProfile[]
  draftSecretRef?: string | null
}

export async function updateProviderFlow(
  port: ProviderFlowPort,
  current: ProviderConnectionRecord,
  values: ProviderFormValues,
  options: UpdateProviderOptions = {}
): Promise<ProviderConnectionRecord> {
  const label = values.label.trim()
  const fields: Partial<Record<ProviderFormField, string>> = {}
  if (!label) fields.label = '请输入连接名称。'
  if (label.length > 80) fields.label = '连接名称不能超过 80 个字符。'
  if (values.presetId === 'custom') {
    const baseError = validateProviderBaseUrl(values.baseUrl.trim())
    if (baseError) fields.baseUrl = baseError
  }
  if (values.enabled && !current.hasSecret && !values.apiKey.trim()) {
    fields.apiKey = '启用真实连接需要现有密钥或新密钥。'
  }
  const customUrlChanged = values.presetId === 'custom' && values.baseUrl.trim() !== (current.baseUrl ?? '')
  if (customUrlChanged && (!options.models || options.models.length === 0) && !values.manualModel.trim()) {
    fields.model = '修改 Base URL 后请重新获取模型，或手工填写模型名。'
  }
  if (Object.keys(fields).length > 0) throw new ProviderFormError(fields)

  const patch: UpdateProviderInput = {}
  if (label !== current.label) patch.label = label
  if (customUrlChanged) {
    patch.baseUrl = values.baseUrl.trim()
  }
  if (values.enabled !== current.enabled) patch.enabled = values.enabled
  if (options.models) patch.models = options.models
  const selectedDefault = (options.models ?? current.models).find(
    (model) => model.id === values.manualModel.trim()
  )
  if (values.presetId === 'custom' && selectedDefault && selectedDefault.id !== current.model) {
    // 自定义连接的“默认模型”落到 legacy model/capabilities，供 probe 与旧流程使用。
    patch.model = selectedDefault.id
    patch.capabilities = selectedDefault.capabilities
  }

  // 只有本次编辑确实拿到过新密钥（预览时写入了草稿密钥）或连接尚无密钥时才轮换，
  // 避免把表单里残留的 Key 当成一次未确认的轮换。
  let rotated = false
  if (values.apiKey.trim() && (!current.hasSecret || options.draftSecretRef)) {
    const { secretRef } = await port.storeSecret({
      label: `provider-secret:${current.id}`,
      value: values.apiKey.trim()
    })
    patch.secretRef = secretRef
    rotated = true
  }

  const updated =
    Object.keys(patch).length === 0 ? current : await port.update(current.id, patch, current.rowVersion)
  if (rotated && options.draftSecretRef) {
    await port.deleteSecret(options.draftSecretRef).catch(() => undefined)
  }
  return updated
}
