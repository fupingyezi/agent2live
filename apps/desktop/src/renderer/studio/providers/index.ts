/** 固定服务商目录、连接表单默认值、连接类型识别、模型统计与默认模型选择。 */
export {
  FIXED_PROVIDER_PRESETS,
  connectionDisplayName,
  connectionModelCounts,
  connectionModels,
  customModelProfile,
  findDefaultTextSelection,
  findDefaultVisionSelection,
  getFixedProviderPreset,
  initialProviderConnectionValues,
  modelKindLabel,
  modelOptionLabel,
  modelsForConnectionKind,
  preferredModel,
  presetIdForConnection,
  presetModelsFor
} from './presets'
export type { ProviderConnectionFormValues, ProviderModelProfile, ProviderPresetId } from './presets'

/** 模型连接创建、更新、密钥写入和可恢复错误。 */
export {
  ProviderConnectionActivationError,
  ProviderConnectionFormError,
  buildCreateConnectionInput,
  createProviderConnectionFlow,
  editConnectionCatalogPatch,
  updateProviderConnectionFlow
} from './create-flow'
export type {
  ProviderConnectionFlowPort,
  ProviderConnectionFormField,
  UpdateProviderConnectionOptions
} from './create-flow'

/** 编辑表单的模型目录预览（草稿密钥 + /models 拉取）。 */
export { previewModelsForForm } from './models-flow'
export type { ProviderModelsPort } from './models-flow'
