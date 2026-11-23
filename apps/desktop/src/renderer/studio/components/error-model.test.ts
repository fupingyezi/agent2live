import { describe, expect, it } from 'vitest'
import type { ProblemDetails } from '@studio/api'
import { ApiError } from '@studio/api'
import { describeStudioError } from './error-model'

function apiProblem(
  overrides: {
    code?: string
    status?: number
    title?: string
    detail?: string
    supportId?: string
    userAction?: ProblemDetails['error']['userAction']
  } = {}
): ProblemDetails {
  const {
    code = 'SYS_INTERNAL',
    status = 500,
    title = '操作失败',
    detail = '服务暂时不可用',
    supportId = 'sup_test_1',
    userAction = 'retry'
  } = overrides
  return {
    type: 'about:blank',
    title,
    status,
    detail,
    instance: '/api/v1/test',
    schemaVersion: 'error/1',
    requestId: 'req_test_1',
    traceId: 'trace_test_1',
    retryable: true,
    retryAfterMs: null,
    error: {
      code,
      category: 'internal',
      severity: 'error',
      messageKey: 'test.failure',
      userAction,
      details: {},
      fieldErrors: []
    },
    supportId
  } as ProblemDetails
}

describe('describeStudioError', () => {
  it('uses a safe generic message for non-API failures', () => {
    const copy = describeStudioError(new Error('secret local path /Users/me/private'))
    expect(copy.title).toBe('操作失败')
    expect(copy.description).toBe('发生了未预期的错误，请重试。')
    expect(copy.code).toBeNull()
    expect(copy.supportId).toBeNull()
    expect(copy.tone).toBe('retryable')
  })

  it('marks local service and auth failures as non-retryable recovery states', () => {
    const localService = describeStudioError(
      new ApiError(apiProblem({ code: 'SYS_LOCAL_SERVICE_UNAVAILABLE' }))
    )
    expect(localService.title).toBe('无法连接本地工作台')
    expect(localService.tone).toBe('blocked')

    const auth = describeStudioError(
      new ApiError(apiProblem({ code: 'AUTH_LOCAL_TOKEN_INVALID', status: 401 }))
    )
    expect(auth.title).toBe('本地会话已失效')
    expect(auth.tone).toBe('fatal')
  })

  it('offers settings only for provider failures that request it', () => {
    const provider = describeStudioError(
      new ApiError(
        apiProblem({
          code: 'PROVIDER_UNAVAILABLE',
          status: 503,
          userAction: 'open_settings'
        })
      )
    )
    expect(provider.title).toBe('AI 服务不可用')
    expect(provider.showSettings).toBe(true)
    expect(provider.code).toBe('PROVIDER_UNAVAILABLE')
    expect(provider.supportId).toBe('sup_test_1')

    const ordinary = describeStudioError(new ApiError(apiProblem({ code: 'RESOURCE_STALE', status: 409 })))
    expect(ordinary.showSettings).toBe(false)
  })

  it('maps 404 to a blocked missing-resource state', () => {
    const copy = describeStudioError(new ApiError(apiProblem({ code: 'RESOURCE_NOT_FOUND', status: 404 })))
    expect(copy.title).toBe('内容不存在')
    expect(copy.tone).toBe('blocked')
    expect(copy.description).toContain('可能已被删除')
  })
})
