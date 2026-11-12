import { z } from 'zod'

export const ERROR_CATEGORIES = [
  'validation',
  'auth',
  'permission',
  'not_found',
  'conflict',
  'rate_limit',
  'dependency',
  'resource',
  'cancelled',
  'security',
  'internal'
] as const

export const USER_ACTIONS = [
  'none',
  'fix_input',
  'reload',
  'refresh_resource',
  'unlock_block',
  'open_settings',
  'reauth',
  'retry',
  'choose_other',
  'contact_support'
] as const

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number]
export type UserAction = (typeof USER_ACTIONS)[number]
export type ErrorSeverity = 'info' | 'warning' | 'error' | 'fatal'

export interface FieldError {
  path: string
  code: string
  messageKey: string
}

export interface ErrorDefinition {
  code: string
  httpStatus: number
  category: ErrorCategory
  retryable: boolean
  severity: ErrorSeverity
  messageKey: string
  userAction: UserAction
  title: string
  defaultDetail: string
  detailsSchema: z.ZodType<Record<string, unknown>>
}

const emptyDetails = z.object({}).strict()

function def(
  code: string,
  httpStatus: number,
  category: ErrorCategory,
  retryable: boolean,
  severity: ErrorSeverity,
  messageKey: string,
  userAction: UserAction,
  title: string,
  defaultDetail: string,
  detailsSchema: z.ZodType<Record<string, unknown>> = emptyDetails
): ErrorDefinition {
  return {
    code,
    httpStatus,
    category,
    retryable,
    severity,
    messageKey,
    userAction,
    title,
    defaultDetail,
    detailsSchema
  }
}

export const ERROR_REGISTRY = {
  REQUEST_INVALID: def(
    'REQUEST_INVALID',
    400,
    'validation',
    false,
    'warning',
    'errors.requestInvalid',
    'fix_input',
    '请求无效',
    '请求格式或参数无效'
  ),
  VALIDATION_FAILED: def(
    'VALIDATION_FAILED',
    400,
    'validation',
    false,
    'warning',
    'errors.validationFailed',
    'fix_input',
    '字段校验失败',
    '部分字段未通过校验'
  ),
  AUTH_LOCAL_TOKEN_INVALID: def(
    'AUTH_LOCAL_TOKEN_INVALID',
    401,
    'auth',
    false,
    'error',
    'errors.authLocalTokenInvalid',
    'reauth',
    '本地访问令牌无效',
    '请重新启动应用以获取本地访问令牌'
  ),
  RESOURCE_NOT_FOUND: def(
    'RESOURCE_NOT_FOUND',
    404,
    'not_found',
    false,
    'info',
    'errors.resourceNotFound',
    'refresh_resource',
    '资源不存在',
    '请求的资源不存在或已删除',
    z.object({ resource: z.string().optional() }).strict()
  ),
  RESOURCE_STALE: def(
    'RESOURCE_STALE',
    409,
    'conflict',
    false,
    'warning',
    'errors.resourceStale',
    'refresh_resource',
    '资源已更新',
    '当前数据已过期，请刷新后重试',
    z.object({ expected: z.string(), actual: z.string() }).strict()
  ),
  RESOURCE_LOCKED: def(
    'RESOURCE_LOCKED',
    423,
    'conflict',
    false,
    'warning',
    'errors.resourceLocked',
    'unlock_block',
    '资源已锁定',
    '该资源已锁定，当前操作不能修改它',
    z.object({ resource: z.string().optional() }).strict()
  ),
  PAYLOAD_TOO_LARGE: def(
    'PAYLOAD_TOO_LARGE',
    413,
    'resource',
    false,
    'warning',
    'errors.payloadTooLarge',
    'fix_input',
    '文件过大',
    '请求体或文件超过大小限制',
    z.object({ limitBytes: z.number().int().positive() }).strict()
  ),
  MEDIA_UNSUPPORTED: def(
    'MEDIA_UNSUPPORTED',
    415,
    'validation',
    false,
    'warning',
    'errors.mediaUnsupported',
    'choose_other',
    '不支持的文件类型',
    '请使用受支持的图片格式'
  ),
  ASSET_HASH_MISMATCH: def(
    'ASSET_HASH_MISMATCH',
    422,
    'validation',
    false,
    'error',
    'errors.assetHashMismatch',
    'fix_input',
    '文件校验失败',
    '上传内容与声明不一致，请重新上传'
  ),
  ASSET_PATH_ESCAPE: def(
    'ASSET_PATH_ESCAPE',
    403,
    'security',
    false,
    'error',
    'errors.assetPathEscape',
    'none',
    '文件路径被拒绝',
    '检测到越界文件路径'
  ),
  SEC_PATH_ESCAPE: def(
    'SEC_PATH_ESCAPE',
    403,
    'security',
    false,
    'error',
    'errors.secPathEscape',
    'none',
    '文件路径被拒绝',
    '检测到越界文件路径'
  ),
  JOB_NOT_FOUND: def(
    'JOB_NOT_FOUND',
    404,
    'not_found',
    false,
    'info',
    'errors.jobNotFound',
    'refresh_resource',
    '任务不存在',
    '任务不存在或已被清理'
  ),
  SYS_INTERNAL: def(
    'SYS_INTERNAL',
    500,
    'internal',
    false,
    'fatal',
    'errors.sysInternal',
    'contact_support',
    '内部错误',
    '发生了未预期的错误，请复制支持码联系支持'
  ),
  SYS_SIDECAR_UNAVAILABLE: def(
    'SYS_SIDECAR_UNAVAILABLE',
    503,
    'dependency',
    true,
    'error',
    'errors.sysSidecarUnavailable',
    'retry',
    '本地服务不可用',
    '本地服务正在启动或已退出，请稍后重试'
  ),
  SYS_STORAGE_FULL: def(
    'SYS_STORAGE_FULL',
    507,
    'resource',
    false,
    'fatal',
    'errors.sysStorageFull',
    'contact_support',
    '存储空间不足',
    '请清理磁盘空间后重试'
  ),
  LIVE2D_CORE_MISSING: def(
    'LIVE2D_CORE_MISSING',
    503,
    'dependency',
    false,
    'error',
    'errors.live2dCoreMissing',
    'open_settings',
    'Live2D 运行时未安装',
    '请安装用户自有的 Cubism Core 后重启应用'
  ),
  MODEL_ENTRY_NOT_FOUND: def(
    'MODEL_ENTRY_NOT_FOUND',
    422,
    'validation',
    false,
    'warning',
    'errors.modelEntryNotFound',
    'fix_input',
    '模型入口无效',
    '模型包缺少可加载的入口文件',
    z.object({ entry: z.string().optional() }).strict()
  ),
  MODEL_REFERENCE_INVALID: def(
    'MODEL_REFERENCE_INVALID',
    422,
    'validation',
    false,
    'warning',
    'errors.modelReferenceInvalid',
    'fix_input',
    '模型引用无效',
    '模型文件包含缺失或越界的引用',
    z.object({ reference: z.string().optional() }).strict()
  ),
  MODEL_QC_FAILED: def(
    'MODEL_QC_FAILED',
    422,
    'validation',
    false,
    'error',
    'errors.modelQcFailed',
    'fix_input',
    '模型质检失败',
    '模型未通过阻塞质检项',
    z.object({ blockers: z.array(z.string()).optional() }).strict()
  ),
  MODEL_RUNTIME_INCOMPATIBLE: def(
    'MODEL_RUNTIME_INCOMPATIBLE',
    422,
    'dependency',
    false,
    'error',
    'errors.modelRuntimeIncompatible',
    'fix_input',
    '模型版本不兼容',
    '模型与当前 Cubism Core 版本不兼容',
    z.object({ mocVersion: z.number().int(), coreVersion: z.number().int().optional() }).strict()
  )
} satisfies Record<string, ErrorDefinition>

export type ErrorCode = keyof typeof ERROR_REGISTRY

const fieldErrorSchema = z
  .object({
    path: z.string(),
    code: z.string(),
    messageKey: z.string()
  })
  .strict()

export const problemDetailsSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int().min(400).max(599),
    detail: z.string(),
    instance: z.string(),
    schemaVersion: z.literal('error/1'),
    requestId: z.string(),
    traceId: z.string(),
    retryable: z.boolean(),
    retryAfterMs: z.number().int().nonnegative().nullable(),
    error: z
      .object({
        code: z.string(),
        category: z.enum(ERROR_CATEGORIES),
        severity: z.enum(['info', 'warning', 'error', 'fatal']),
        messageKey: z.string(),
        userAction: z.enum(USER_ACTIONS),
        details: z.record(z.string(), z.unknown()),
        fieldErrors: z.array(fieldErrorSchema)
      })
      .strict(),
    supportId: z.string()
  })
  .strict()

export type ProblemDetails = z.infer<typeof problemDetailsSchema>

export interface BuildProblemInput {
  code: string
  requestId: string
  traceId: string
  supportId?: string
  instance: string
  detail?: string
  details?: Record<string, unknown>
  fieldErrors?: FieldError[]
  retryAfterMs?: number | null
}

export function getErrorDefinition(code: string): ErrorDefinition {
  if (Object.hasOwn(ERROR_REGISTRY, code)) {
    return ERROR_REGISTRY[code as ErrorCode]!
  }
  return ERROR_REGISTRY.SYS_INTERNAL!
}

export function buildProblem(input: BuildProblemInput): ProblemDetails {
  const def = getErrorDefinition(input.code)
  const isInternal = def.code === 'SYS_INTERNAL'
  const rawDetails = isInternal ? {} : (input.details ?? {})
  const parsedDetails = def.detailsSchema.safeParse(rawDetails)
  if (!parsedDetails.success) {
    throw new Error(`error details do not match ${def.code} schema`)
  }
  const detail = isInternal ? def.defaultDetail : (input.detail ?? def.defaultDetail)
  return {
    type: `https://app.local/errors/${def.code}`,
    title: def.title,
    status: def.httpStatus,
    detail,
    instance: input.instance,
    schemaVersion: 'error/1',
    requestId: input.requestId,
    traceId: input.traceId,
    retryable: def.retryable,
    retryAfterMs: input.retryAfterMs ?? null,
    error: {
      code: def.code,
      category: def.category,
      severity: def.severity,
      messageKey: def.messageKey,
      userAction: def.userAction,
      details: parsedDetails.data,
      fieldErrors: input.fieldErrors ?? []
    },
    supportId: input.supportId ?? input.requestId
  }
}
