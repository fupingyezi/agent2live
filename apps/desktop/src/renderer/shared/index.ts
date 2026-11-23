/** Studio 与 Pet 共用的 Live2D 挂载和 URL 解析能力。 */
export { modelUrlFromSearch, mountModel } from './live2d-stage'
export type { EmptyProps, StageResult } from './model-types'

/** Studio 与 Pet 共用的本地服务 HTTP 请求和错误归一化能力。 */
export { ApiClient, ApiError, formatIfMatch, newIdempotencyKey } from './http/client'
export type { ApiRequestOptions, FetchLike } from './http/client'

/** 页面内 Live2D 探测面板，用于开发态展示模型加载结果。 */
export { ProbePanel } from './probe-panel'
export type { ProbePanelProps } from './probe-panel'
