import type { CreateProviderConnectionInput, UpdateProviderConnectionInput } from '@agent2live/contracts/api'
import { providerModelProfileSchema, type ProviderModelProfile } from '@agent2live/contracts/provider-catalog'
import type { ProviderConnectionDto } from '@studio/api'
import {
  customModelProfile,
  getFixedProviderPreset,
  selectedModelId,
  type ProviderConnectionFormValues
} from './presets'

export interface ProviderConnectionFlowPort {
  create(input: CreateProviderConnectionInput): Promise<ProviderConnectionDto>
  update(id: string, patch: UpdateProviderConnectionInput, rowVersion: number): Promise<ProviderConnectionDto>
  get(id: string): Promise<ProviderConnectionDto>
  storeSecret(input: { label: string; value: string }): Promise<{ secretRef: string }>
  deleteSecret(secretRef: string): Promise<void>
}

export type ProviderConnectionFormField = 'label' | 'baseUrl' | 'model' | 'apiKey'

export class ProviderConnectionFormError extends Error {
  readonly fields: Partial<Record<ProviderConnectionFormField, string>>
  constructor(fields: Partial<Record<ProviderConnectionFormField, string>>) {
    super('连接表单校验失败')
    this.name = 'ProviderConnectionFormError'
    this.fields = fields
  }
}

export class ProviderConnectionActivationError extends Error {
  readonly connectionId: string
  constructor(connectionId: string, cause: unknown) {
    super('模型供应商已创建，但启用失败。请检查密钥后重试。')
    this.name = 'ProviderConnectionActivationError'
    this.connectionId = connectionId
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

function resolveProfiles(
  values: ProviderConnectionFormValues,
  models: ProviderModelProfile[]
): ProviderModelProfile[] {
  if (models.length > 0) return models.map((model) => providerModelProfileSchema.parse(model))
  if (values.presetId !== 'custom') {
    const preset = getFixedProviderPreset(values.presetId)
    if (preset && preset.presetModels.length > 0) {
      return preset.presetModels.map((model) => providerModelProfileSchema.parse(model))
    }
    throw new ProviderConnectionFormError({ model: '请选择模型。' })
  }
  if (!values.customModelId.trim()) {
    throw new ProviderConnectionFormError({ model: '请输入模型名。' })
  }
  return [providerModelProfileSchema.parse(customModelProfile(values))]
}

function representativeProfile(
  values: ProviderConnectionFormValues,
  profiles: ProviderModelProfile[]
): ProviderModelProfile {
  const requested = profiles.find((model) => model.id === selectedModelId(values))
  if (requested) return requested
  return (
    profiles.find((model) => model.kind === values.kind) ??
    profiles.find((model) => model.kind === 'chat') ??
    profiles[0]!
  )
}

export function buildCreateConnectionInput(
  values: ProviderConnectionFormValues,
  models: ProviderModelProfile[]
): CreateProviderConnectionInput {
  const label = values.label.trim()
  const fields: Partial<Record<ProviderConnectionFormField, string>> = {}
  if (!label) fields.label = '请输入连接名称。'
  if (label.length > 80) fields.label = '连接名称不能超过 80 个字符。'
  if (!values.apiKey.trim()) fields.apiKey = '请输入 API Key。'
  if (values.presetId === 'custom') {
    const baseError = validateProviderBaseUrl(values.baseUrl.trim())
    if (baseError) fields.baseUrl = baseError
  }
  if (Object.keys(fields).length > 0) throw new ProviderConnectionFormError(fields)

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

export async function createProviderConnectionFlow(
  port: ProviderConnectionFlowPort,
  values: ProviderConnectionFormValues,
  models: ProviderModelProfile[],
  draftSecretRef: string | null
): Promise<ProviderConnectionDto> {
  const created = await port.create(buildCreateConnectionInput(values, models))
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
    throw new ProviderConnectionActivationError(created.id, error)
  }
}

export interface UpdateProviderConnectionOptions {
  models?: ProviderModelProfile[]
  draftSecretRef?: string | null
}

/**
 * 编辑模式应提交的模型目录补丁。
 * 仅轮换密钥时保留已保存目录；自定义 Base URL 变更后旧目录属于旧端点，
 * 必须携带刚拉取的模型或手工模型，不能让旧目录静默通过。
 */
export function editConnectionCatalogPatch(
  values: ProviderConnectionFormValues,
  current: ProviderConnectionDto,
  models: ProviderModelProfile[] | null
): ProviderModelProfile[] | undefined {
  if (values.presetId !== 'custom') return undefined
  const urlChanged = values.baseUrl.trim() !== (current.baseUrl ?? '')
  if (urlChanged) {
    if (models !== null && models.length > 0) return models
    return values.customModelId.trim() ? [customModelProfile(values)] : undefined
  }
  if (models !== null && models.length > 0 && JSON.stringify(models) !== JSON.stringify(current.models)) {
    return models
  }
  if (
    (models === null || models.length === 0) &&
    current.models.length === 0 &&
    values.customModelId.trim()
  ) {
    return [customModelProfile(values)]
  }
  return undefined
}

export async function updateProviderConnectionFlow(
  port: ProviderConnectionFlowPort,
  current: ProviderConnectionDto,
  values: ProviderConnectionFormValues,
  options: UpdateProviderConnectionOptions = {}
): Promise<ProviderConnectionDto> {
  const label = values.label.trim()
  const fields: Partial<Record<ProviderConnectionFormField, string>> = {}
  if (!label) fields.label = '请输入连接名称。'
  if (label.length > 80) fields.label = '连接名称不能超过 80 个字符。'
  if (values.presetId === 'custom') {
    const baseError = validateProviderBaseUrl(values.baseUrl.trim())
    if (baseError) fields.baseUrl = baseError
  }
  if (values.enabled && !current.hasSecret && !values.apiKey.trim()) {
    fields.apiKey = '启用真实供应商需要现有密钥或新密钥。'
  }
  const customUrlChanged = values.presetId === 'custom' && values.baseUrl.trim() !== (current.baseUrl ?? '')
  if (customUrlChanged && (!options.models || options.models.length === 0) && !values.customModelId.trim()) {
    fields.model = '修改 Base URL 后请重新获取模型，或手工填写模型名。'
  }
  if (Object.keys(fields).length > 0) throw new ProviderConnectionFormError(fields)

  const patch: UpdateProviderConnectionInput = {}
  if (label !== current.label) patch.label = label
  if (customUrlChanged) {
    patch.baseUrl = values.baseUrl.trim()
  }
  if (values.enabled !== current.enabled) patch.enabled = values.enabled
  if (options.models) patch.models = options.models
  const selectedDefault = (options.models ?? current.models).find(
    (model) => model.id === selectedModelId(values)
  )
  if (selectedDefault && selectedDefault.kind !== current.kind) {
    throw new ProviderConnectionFormError({ model: '所选模型类型与连接类型不一致。' })
  }
  if (selectedDefault && selectedDefault.adapter !== current.adapter) {
    throw new ProviderConnectionFormError({ model: '所选模型协议与连接协议不一致。' })
  }
  if (selectedDefault && selectedDefault.id !== current.model) {
    // 设置页选中的默认模型落到 legacy model/capabilities，后续任务默认使用它。
    patch.model = selectedDefault.id
    patch.capabilities = selectedDefault.capabilities
  }

  let rotated = false
  if (values.apiKey.trim()) {
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
