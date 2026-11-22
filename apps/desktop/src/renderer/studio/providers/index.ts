/** 固定服务商目录、表单默认值、连接类型识别、模型统计与默认模型选择。 */
export {
  FIXED_PROVIDER_PRESETS,
  findDefaultTextSelection,
  findDefaultVisionSelection,
  getFixedProviderPreset,
  initialProviderValues,
  manualModelProfile,
  presetIdForConnection,
  providerCounts,
  providerDisplayName,
  providerModels
} from './presets'
export type { ProviderFormValues, ProviderModelProfile, ProviderPresetId } from './presets'

/** 模型连接创建、更新、密钥写入和可恢复错误。 */
export {
  ProviderActivationError,
  ProviderFormError,
  buildCreateInput,
  createProviderFlow,
  updateProviderFlow
} from './create-flow'
export type {
  CreateProviderInput,
  ProviderConnectionRecord,
  ProviderFlowPort,
  ProviderFormField,
  UpdateProviderInput,
  UpdateProviderOptions
} from './create-flow'

/** 编辑表单的模型目录预览（草稿密钥 + /models 拉取）。 */
export { previewModelsForForm } from './models-flow'
export type { ProviderModelsPort } from './models-flow'
