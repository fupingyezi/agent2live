import type { ProviderModelsPreviewInput } from '@agent2live/contracts/provider-catalog'
import type { ProviderConnectionDto, ProviderModelProfile } from '@studio/api'
import { ProviderFormError, validateProviderBaseUrl } from './create-flow'
import type { ProviderFormValues } from './presets'

export interface ProviderModelsPort {
  storeSecret(input: { label: string; value: string }): Promise<{ secretRef: string }>
  deleteSecret(secretRef: string): Promise<void>
  previewModels(input: ProviderModelsPreviewInput): Promise<ProviderModelProfile[]>
  refreshModels(connectionId: string, rowVersion: number): Promise<ProviderConnectionDto>
}

export async function previewModelsForForm(
  port: ProviderModelsPort,
  values: ProviderFormValues,
  draftLabel: string
): Promise<{ secretRef: string; models: ProviderModelProfile[] }> {
  const apiKey = values.apiKey.trim()
  if (!apiKey) throw new ProviderFormError({ apiKey: '请输入 API Key。' })

  const input: ProviderModelsPreviewInput =
    values.presetId === 'custom'
      ? (() => {
          const baseUrl = values.baseUrl.trim()
          const baseError = validateProviderBaseUrl(baseUrl)
          if (baseError) throw new ProviderFormError({ baseUrl: baseError })
          return {
            target: 'custom' as const,
            kind: values.kind,
            adapter: values.adapter,
            baseUrl,
            secretRef: ''
          }
        })()
      : { target: 'preset', presetId: values.presetId, secretRef: '' }

  const { secretRef } = await port.storeSecret({ label: draftLabel, value: apiKey })
  try {
    const models = await port.previewModels({ ...input, secretRef })
    return { secretRef, models }
  } catch (error) {
    // 预览失败时草稿密钥不会回到页面，必须就地清理，不能留到启动清扫。
    await port.deleteSecret(secretRef).catch(() => undefined)
    throw error
  }
}
