/** Studio sidecar 请求、错误归一化和幂等键工具。 */
export { ApiClient, ApiError, formatIfMatch, newIdempotencyKey } from './client'
export type { ApiRequestOptions, FetchLike } from './client'

/** TanStack Query 缓存的统一 key 工厂与 SSE 事件失效规则。 */
export { queryKeys } from './keys'
export { invalidateForEvent } from './invalidation'

/** Studio 业务端点、文件上传、版本与生成任务操作。 */
export * from './queries'

/** Sidecar SSE 协议解析、连接状态和断线重连流。 */
export * from './sse'

/** sidecar DTO 在 renderer 时间与视图层中的类型。 */
export type * from './types'
