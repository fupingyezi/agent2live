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
    '请求格式或参数无效',
    z
      .object({
        reason: z.string().max(200).optional(),
        issues: z
          .array(z.object({ path: z.string().max(200), code: z.string().max(80) }))
          .max(50)
          .optional()
      })
      .strict()
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
  ),
  PROVIDER_AUTH_FAILED: def(
    'PROVIDER_AUTH_FAILED',
    401,
    'auth',
    false,
    'error',
    'errors.providerAuthFailed',
    'open_settings',
    '模型服务认证失败',
    '请检查服务凭据与访问权限'
  ),
  PROVIDER_RATE_LIMITED: def(
    'PROVIDER_RATE_LIMITED',
    429,
    'rate_limit',
    true,
    'warning',
    'errors.providerRateLimited',
    'retry',
    '模型服务限流',
    '请求过于频繁，请稍后重试'
  ),
  PROVIDER_TIMEOUT: def(
    'PROVIDER_TIMEOUT',
    504,
    'dependency',
    true,
    'warning',
    'errors.providerTimeout',
    'retry',
    '模型服务超时',
    '等待模型服务响应超时'
  ),
  PROVIDER_UNAVAILABLE: def(
    'PROVIDER_UNAVAILABLE',
    503,
    'dependency',
    true,
    'error',
    'errors.providerUnavailable',
    'retry',
    '模型服务不可用',
    '模型服务暂时不可用'
  ),
  PROVIDER_INVALID_REQUEST: def(
    'PROVIDER_INVALID_REQUEST',
    422,
    'validation',
    false,
    'warning',
    'errors.providerInvalidRequest',
    'fix_input',
    '模型请求无效',
    '请求参数不被模型服务接受'
  ),
  PROVIDER_CONTENT_REJECTED: def(
    'PROVIDER_CONTENT_REJECTED',
    422,
    'validation',
    false,
    'warning',
    'errors.providerContentRejected',
    'fix_input',
    '内容被模型服务拒绝',
    '请修改提示词或参考图后重试'
  ),
  PROVIDER_INVALID_RESPONSE: def(
    'PROVIDER_INVALID_RESPONSE',
    502,
    'dependency',
    false,
    'error',
    'errors.providerInvalidResponse',
    'contact_support',
    '模型响应无效',
    '模型服务返回了无法解析的数据'
  ),
  PROVIDER_CANCELLED: def(
    'PROVIDER_CANCELLED',
    408,
    'cancelled',
    false,
    'info',
    'errors.providerCancelled',
    'none',
    '已取消',
    '请求已取消'
  ),
  PRECONDITION_REQUIRED: def(
    'PRECONDITION_REQUIRED',
    428,
    'validation',
    false,
    'warning',
    'errors.preconditionRequired',
    'refresh_resource',
    '请求缺少前置条件',
    '请刷新后重试',
    z.object({ header: z.literal('If-Match') }).strict()
  ),
  IDEMPOTENCY_KEY_REQUIRED: def(
    'IDEMPOTENCY_KEY_REQUIRED',
    428,
    'validation',
    false,
    'warning',
    'errors.idempotencyKeyRequired',
    'retry',
    '请求缺少幂等键',
    '请使用幂等键重试',
    z.object({}).strict()
  ),
  IDEMPOTENCY_KEY_REUSED: def(
    'IDEMPOTENCY_KEY_REUSED',
    409,
    'conflict',
    false,
    'warning',
    'errors.idempotencyKeyReused',
    'retry',
    '幂等键用于了不同请求',
    '请使用新的幂等键',
    z.object({ scope: z.string().max(120) }).strict()
  ),
  CHARACTER_BRIEF_IMMUTABLE: def(
    'CHARACTER_BRIEF_IMMUTABLE',
    409,
    'conflict',
    false,
    'error',
    'errors.characterBriefImmutable',
    'refresh_resource',
    '角色设定版本不可修改',
    '请基于当前版本创建新的设定版本',
    z.object({ versionId: z.string().max(64) }).strict()
  ),
  CHARACTER_BRIEF_NOT_FOUND: def(
    'CHARACTER_BRIEF_NOT_FOUND',
    404,
    'not_found',
    false,
    'warning',
    'errors.characterBriefNotFound',
    'reload',
    '角色设定版本不存在',
    '请刷新角色后重试',
    z.object({ versionId: z.string().max(64).optional() }).strict()
  ),
  CHARACTER_BRIEF_INPUT_CONFLICT: def(
    'CHARACTER_BRIEF_INPUT_CONFLICT',
    422,
    'validation',
    false,
    'warning',
    'errors.characterBriefInputConflict',
    'fix_input',
    '不能同时提交内联设定和设定版本',
    '请只保留一种设定来源',
    z.object({}).strict()
  ),
  CHARACTER_BRIEF_STALE: def(
    'CHARACTER_BRIEF_STALE',
    409,
    'conflict',
    false,
    'warning',
    'errors.characterBriefStale',
    'refresh_resource',
    '角色设定已变化',
    '请刷新角色后重新提交',
    z
      .object({
        expected: z.string().max(64).nullable(),
        actual: z.string().max(64).nullable()
      })
      .strict()
  ),
  ART_REFERENCE_SET_INVALID: def(
    'ART_REFERENCE_SET_INVALID',
    422,
    'validation',
    false,
    'warning',
    'errors.artReferenceSetInvalid',
    'fix_input',
    '参考图集合无效',
    '请至少保留一张且不重复使用图片',
    z.object({ reasons: z.array(z.string().max(120)).max(20) }).strict()
  ),
  ART_REFERENCE_PRIMARY_REQUIRED: def(
    'ART_REFERENCE_PRIMARY_REQUIRED',
    422,
    'validation',
    false,
    'warning',
    'errors.artReferencePrimaryRequired',
    'fix_input',
    '必须指定一张主参考图',
    '请将一张参考图设为主图',
    z.object({}).strict()
  ),
  ART_REFERENCE_ORDER_INVALID: def(
    'ART_REFERENCE_ORDER_INVALID',
    422,
    'validation',
    false,
    'warning',
    'errors.artReferenceOrderInvalid',
    'fix_input',
    '参考图顺序无效',
    '主图必须为 0，其余从 1 连续编号',
    z
      .object({
        primarySortOrder: z.number().int().nonnegative(),
        orders: z.array(z.number().int().nonnegative()).max(32)
      })
      .strict()
  ),
  PROMPT_INPUT_EMPTY: def(
    'PROMPT_INPUT_EMPTY',
    422,
    'validation',
    false,
    'warning',
    'errors.promptInputEmpty',
    'fix_input',
    '没有可用的初始输入',
    '请填写角色设定或上传至少一张参考图',
    z.object({}).strict()
  ),
  PROMPT_BASE_STALE: def(
    'PROMPT_BASE_STALE',
    409,
    'conflict',
    false,
    'warning',
    'errors.promptBaseStale',
    'refresh_resource',
    '提示词基线已变化',
    '请刷新草稿后重新生成建议',
    z
      .object({
        expectedHash: z.string().regex(/^[0-9a-f]{64}$/),
        actualHash: z.string().regex(/^[0-9a-f]{64}$/)
      })
      .strict()
  ),
  PROMPT_BLOCK_LOCKED: def(
    'PROMPT_BLOCK_LOCKED',
    423,
    'conflict',
    false,
    'warning',
    'errors.promptBlockLocked',
    'unlock_block',
    '锁定块不可修改',
    '请先解锁该块再采纳建议',
    z.object({ blockId: z.string().max(100) }).strict()
  ),
  PROMPT_DRAFT_REQUIRED: def(
    'PROMPT_DRAFT_REQUIRED',
    409,
    'conflict',
    false,
    'warning',
    'errors.promptDraftRequired',
    'reload',
    '需要先创建草稿',
    '请从当前提示词版本创建草稿',
    z.object({ artProjectId: z.string().max(64) }).strict()
  ),
  PROMPT_VERSION_IMMUTABLE: def(
    'PROMPT_VERSION_IMMUTABLE',
    409,
    'conflict',
    false,
    'error',
    'errors.promptVersionImmutable',
    'refresh_resource',
    '提示词版本不可修改',
    '已提交版本只能 Fork 或新建草稿',
    z.object({ versionId: z.string().max(64) }).strict()
  ),
  PROMPT_REFERENCE_LIMIT: def(
    'PROMPT_REFERENCE_LIMIT',
    422,
    'validation',
    false,
    'warning',
    'errors.promptReferenceLimit',
    'fix_input',
    '参考图数量超出模型能力',
    '请减少素材或切换模型',
    z
      .object({
        requested: z.number().int().nonnegative(),
        limit: z.number().int().nonnegative()
      })
      .strict()
  ),
  PROMPT_LENGTH_EXCEEDS_LIMIT: def(
    'PROMPT_LENGTH_EXCEEDS_LIMIT',
    422,
    'validation',
    false,
    'warning',
    'errors.promptLengthExceedsLimit',
    'fix_input',
    '提示词超出模型上限',
    '请缩短非锁定块或更换模型',
    z
      .object({
        length: z.number().int().nonnegative(),
        limit: z.number().int().nonnegative()
      })
      .strict()
  ),
  PROMPT_OPERATION_INVALID: def(
    'PROMPT_OPERATION_INVALID',
    422,
    'validation',
    false,
    'warning',
    'errors.promptOperationInvalid',
    'fix_input',
    'AI 操作不合法',
    '请重新生成建议',
    z.object({ reason: z.string().max(100) }).strict()
  ),
  PROMPT_OPERATION_STALE: def(
    'PROMPT_OPERATION_STALE',
    409,
    'conflict',
    false,
    'warning',
    'errors.promptOperationStale',
    'refresh_resource',
    'AI 操作的基线已变化',
    '请刷新草稿后重新生成建议',
    z.object({ blockId: z.string().max(100) }).strict()
  ),
  PROMPT_BRIEF_PROJECTION_STALE: def(
    'PROMPT_BRIEF_PROJECTION_STALE',
    409,
    'conflict',
    false,
    'warning',
    'errors.promptBriefProjectionStale',
    'refresh_resource',
    '角色设定投影已变化',
    '请基于当前角色设定重新生成草稿',
    z.object({}).strict()
  ),
  PROMPT_REVERSE_INVALID_OUTPUT: def(
    'PROMPT_REVERSE_INVALID_OUTPUT',
    502,
    'dependency',
    true,
    'warning',
    'errors.promptReverseInvalidOutput',
    'retry',
    '反推结果无法解析',
    '可以重试反推',
    z.object({ attempt: z.number().int().positive() }).strict()
  ),
  PROMPT_REVERSE_STALE: def(
    'PROMPT_REVERSE_STALE',
    409,
    'conflict',
    false,
    'warning',
    'errors.promptReverseStale',
    'refresh_resource',
    '反推基线已变化',
    '请基于当前草稿重新反推',
    z
      .object({
        baseDraftRowVersion: z.number().int().positive(),
        currentDraftRowVersion: z.number().int().positive().nullable()
      })
      .strict()
  ),
  PROMPT_REVERSE_RESOLVED: def(
    'PROMPT_REVERSE_RESOLVED',
    409,
    'conflict',
    false,
    'info',
    'errors.promptReverseResolved',
    'reload',
    '反推结果已经处理',
    '请刷新结果列表',
    z.object({ status: z.enum(['applied', 'discarded']) }).strict()
  ),
  PROMPT_SUGGESTION_INVALID_OUTPUT: def(
    'PROMPT_SUGGESTION_INVALID_OUTPUT',
    502,
    'dependency',
    true,
    'warning',
    'errors.promptSuggestionInvalidOutput',
    'retry',
    '建议无法解析或不可应用',
    '可以重试生成建议',
    z
      .object({
        attempt: z.number().int().positive()
      })
      .strict()
  ),
  PROMPT_SUGGESTION_RESOLVED: def(
    'PROMPT_SUGGESTION_RESOLVED',
    409,
    'conflict',
    false,
    'info',
    'errors.promptSuggestionResolved',
    'reload',
    '建议已经处理',
    '请刷新建议列表',
    z
      .object({
        status: z.enum(['accepted', 'rejected', 'stale'])
      })
      .strict()
  ),
  PROMPT_DRAFT_EXISTS: def(
    'PROMPT_DRAFT_EXISTS',
    409,
    'conflict',
    false,
    'warning',
    'errors.promptDraftExists',
    'reload',
    '项目已有活动草稿',
    '请刷新后继续编辑现有草稿',
    z.object({ draftId: z.string().max(64) }).strict()
  ),
  PROMPT_INPUT_REQUIRED: def(
    'PROMPT_INPUT_REQUIRED',
    409,
    'conflict',
    false,
    'warning',
    'errors.promptInputRequired',
    'fix_input',
    '需要先上传素材与要求',
    '请先提交素材和要求',
    z.object({ artProjectId: z.string().max(64) }).strict()
  ),
  PROMPT_INPUT_MISMATCH: def(
    'PROMPT_INPUT_MISMATCH',
    409,
    'conflict',
    false,
    'warning',
    'errors.promptInputMismatch',
    'fix_input',
    '提示词引用了失效的输入',
    '请先移除失效引用',
    z
      .object({
        missingAssetIds: z.array(z.string().max(64)).max(20),
        missingRequirementIds: z.array(z.string().max(80)).max(50)
      })
      .strict()
  ),
  PROMPT_REQUIREMENT_UNCOVERED: def(
    'PROMPT_REQUIREMENT_UNCOVERED',
    422,
    'validation',
    false,
    'warning',
    'errors.promptRequirementUncovered',
    'fix_input',
    '有必须要求未被覆盖',
    '请补充块或确认忽略',
    z.object({ requirementIds: z.array(z.string().max(80)).max(50) }).strict()
  ),
  PROMPT_VERSION_REQUIRED: def(
    'PROMPT_VERSION_REQUIRED',
    409,
    'conflict',
    false,
    'warning',
    'errors.promptVersionRequired',
    'fix_input',
    '需要先提交提示词版本',
    '请先完成提示词并提交版本',
    z.object({ artProjectId: z.string().max(64) }).strict()
  ),
  ART_ACTIVE_VERSION_CHANGED: def(
    'ART_ACTIVE_VERSION_CHANGED',
    409,
    'conflict',
    false,
    'warning',
    'errors.artActiveVersionChanged',
    'refresh_resource',
    '当前立绘版本已变化',
    '请刷新后重新比较候选',
    z
      .object({
        expected: z.string().max(64).nullable(),
        actual: z.string().max(64).nullable()
      })
      .strict()
  ),
  ART_VERSION_IMMUTABLE: def(
    'ART_VERSION_IMMUTABLE',
    409,
    'conflict',
    false,
    'error',
    'errors.artVersionImmutable',
    'refresh_resource',
    '立绘版本不可修改',
    '请新建版本或切换 active',
    z.object({ versionId: z.string().max(64) }).strict()
  ),
  ART_IMAGE_INVALID: def(
    'ART_IMAGE_INVALID',
    422,
    'validation',
    false,
    'warning',
    'errors.artImageInvalid',
    'fix_input',
    '立绘图片无效',
    '请检查图片格式、尺寸与内容',
    z.object({ reasons: z.array(z.string().max(80)).max(20) }).strict()
  ),
  ART_CANDIDATE_NOT_ACCEPTABLE: def(
    'ART_CANDIDATE_NOT_ACCEPTABLE',
    409,
    'conflict',
    false,
    'warning',
    'errors.artCandidateNotAcceptable',
    'refresh_resource',
    '候选不可采纳',
    '请刷新后选择仍然就绪的候选',
    z
      .object({
        candidateId: z.string().max(64),
        status: z.enum(['ready', 'accepted', 'rejected', 'expired'])
      })
      .strict()
  ),
  FORK_BRANCH_CONFLICT: def(
    'FORK_BRANCH_CONFLICT',
    409,
    'conflict',
    false,
    'warning',
    'errors.forkBranchConflict',
    'fix_input',
    '分支名在父项目中已存在',
    '请更换分支名',
    z
      .object({
        parentProjectId: z.string().max(64),
        branchLabel: z.string().max(80)
      })
      .strict()
  ),
  FORK_SOURCE_UNCOMMITTED: def(
    'FORK_SOURCE_UNCOMMITTED',
    409,
    'conflict',
    false,
    'warning',
    'errors.forkSourceUncommitted',
    'reload',
    'Fork 源尚未提交',
    '请先提交版本',
    z.object({}).strict()
  ),
  JOB_CANCEL_NOT_ALLOWED: def(
    'JOB_CANCEL_NOT_ALLOWED',
    409,
    'conflict',
    false,
    'warning',
    'errors.jobCancelNotAllowed',
    'refresh_resource',
    '任务当前不可取消',
    '请刷新任务状态',
    z
      .object({
        status: z.enum(['succeeded', 'failed', 'cancelled', 'unknown_outcome'])
      })
      .strict()
  ),
  JOB_LEASE_LOST: def(
    'JOB_LEASE_LOST',
    409,
    'conflict',
    false,
    'warning',
    'errors.jobLeaseLost',
    'retry',
    '任务租约已失效',
    '请重试操作',
    z.object({ jobId: z.string().max(64) }).strict()
  ),
  PROVIDER_NOT_CONFIGURED: def(
    'PROVIDER_NOT_CONFIGURED',
    422,
    'validation',
    false,
    'warning',
    'errors.providerNotConfigured',
    'open_settings',
    '模型服务未配置',
    '请在设置中启用并填写模型服务',
    z.object({ connectionId: z.string().max(64).optional() }).strict()
  ),
  PROVIDER_CAPABILITY_UNSUPPORTED: def(
    'PROVIDER_CAPABILITY_UNSUPPORTED',
    422,
    'validation',
    false,
    'warning',
    'errors.providerCapabilityUnsupported',
    'choose_other',
    '模型缺少所需能力',
    '请更换支持参考图的生图模型',
    z.object({ capability: z.string().max(80) }).strict()
  ),
  PROVIDER_BILLABLE_CONFIRMATION_REQUIRED: def(
    'PROVIDER_BILLABLE_CONFIRMATION_REQUIRED',
    422,
    'validation',
    false,
    'warning',
    'errors.providerBillableConfirmationRequired',
    'fix_input',
    '需要确认生图测试',
    '该测试会调用生图模型并可能产生费用，请确认后继续',
    z.object({ connectionId: z.string().max(64) }).strict()
  ),
  BACKUP_FAILED: def(
    'BACKUP_FAILED',
    500,
    'resource',
    true,
    'error',
    'errors.backupFailed',
    'retry',
    '备份失败',
    '请重试导出',
    z.object({}).strict()
  ),
  BACKUP_NOT_READY: def(
    'BACKUP_NOT_READY',
    409,
    'conflict',
    false,
    'info',
    'errors.backupNotReady',
    'refresh_resource',
    '备份尚未就绪',
    '请等待备份任务完成',
    z
      .object({
        status: z.enum(['queued', 'leased', 'running', 'retrying', 'waiting_user'])
      })
      .strict()
  ),
  BACKUP_TOO_LARGE: def(
    'BACKUP_TOO_LARGE',
    413,
    'resource',
    false,
    'warning',
    'errors.backupTooLarge',
    'choose_other',
    '备份体积超过上限',
    '请先清理未引用资产',
    z
      .object({
        bytes: z.number().int().nonnegative(),
        limit: z.number().int().positive()
      })
      .strict()
  ),
  ASSET_INVALID: def(
    'ASSET_INVALID',
    422,
    'validation',
    false,
    'warning',
    'errors.assetInvalid',
    'fix_input',
    '素材文件无效',
    '仅支持 PNG/JPEG/WebP 图片',
    z.object({ reasons: z.array(z.string().max(80)).max(20) }).strict()
  ),
  ASSET_TOO_LARGE: def(
    'ASSET_TOO_LARGE',
    413,
    'validation',
    false,
    'warning',
    'errors.assetTooLarge',
    'fix_input',
    '素材文件过大',
    '请上传更小的图片',
    z
      .object({
        bytes: z.number().int().nonnegative(),
        limit: z.number().int().positive()
      })
      .strict()
  ),
  ASSET_NOT_FOUND: def(
    'ASSET_NOT_FOUND',
    404,
    'not_found',
    false,
    'warning',
    'errors.assetNotFound',
    'reload',
    '素材不存在',
    '请刷新素材列表',
    z.object({}).strict()
  ),
  PROJECT_HAS_ACTIVE_JOBS: def(
    'PROJECT_HAS_ACTIVE_JOBS',
    409,
    'conflict',
    false,
    'warning',
    'errors.projectHasActiveJobs',
    'refresh_resource',
    '项目仍有任务运行',
    '请等待或取消任务后再删除',
    z.object({ jobIds: z.array(z.string().max(64)).max(20) }).strict()
  ),
  RESOURCE_DELETED: def(
    'RESOURCE_DELETED',
    410,
    'not_found',
    false,
    'warning',
    'errors.resourceDeleted',
    'reload',
    '资源已删除',
    '该资源已被删除',
    z.object({ resource: z.enum(['character', 'artProject']) }).strict()
  ),
  ROW_VERSION_CONFLICT: def(
    'ROW_VERSION_CONFLICT',
    409,
    'conflict',
    false,
    'warning',
    'errors.rowVersionConflict',
    'refresh_resource',
    '资源已被修改',
    '请刷新后重试',
    z
      .object({
        expected: z.number().int().nonnegative(),
        actual: z.number().int().nonnegative().optional()
      })
      .strict()
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
