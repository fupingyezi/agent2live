/** 模型连接预设、表单默认值、连接类型识别及默认视觉连接选择。 */
export {
  PROVIDER_PRESETS,
  findDefaultVisionProvider,
  getProviderPreset,
  initialProviderValues,
  presetIdForConnection
} from './presets'
export type { ProviderFormValues, ProviderPreset, ProviderPresetId } from './presets'

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
  UpdateProviderInput
} from './create-flow'
