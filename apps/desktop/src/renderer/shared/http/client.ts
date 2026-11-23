import { problemDetailsSchema } from '@agent2live/contracts/errors'
import type { FieldError, LocalServiceInfo, ProblemDetails, UserAction } from '@agent2live/contracts'

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  headers?: HeadersInit
  signal?: AbortSignal
  timeoutMs?: number
  idempotencyKey?: string
  ifMatch?: number | string | null
  accept?: string
}

export class ApiError extends Error {
  readonly problem: ProblemDetails
  readonly code: string
  readonly status: number
  readonly retryable: boolean
  readonly userAction: UserAction
  readonly fieldErrors: FieldError[]
  readonly requestId: string
  readonly supportId: string

  constructor(problem: ProblemDetails) {
    super(problem.detail)
    this.name = 'ApiError'
    this.problem = problem
    this.code = problem.error.code
    this.status = problem.status
    this.retryable = problem.retryable
    this.userAction = problem.error.userAction
    this.fieldErrors = problem.error.fieldErrors
    this.requestId = problem.requestId
    this.supportId = problem.supportId
  }
}

const LOCAL_SERVICE_UNAVAILABLE_DETAIL = '本地服务正在启动或已退出，请稍后重试'
const INVALID_JSON_DETAIL = '本地服务返回了无法解析的数据。'

function syntheticProblem(
  code: 'SYS_INTERNAL' | 'SYS_LOCAL_SERVICE_UNAVAILABLE',
  status: number,
  retryable: boolean,
  detail: string
): ProblemDetails {
  return {
    type: 'about:blank',
    title: '本地服务错误',
    status,
    detail,
    instance: '',
    schemaVersion: 'error/1',
    requestId: '',
    traceId: '',
    retryable,
    retryAfterMs: null,
    error: {
      code,
      category: code === 'SYS_LOCAL_SERVICE_UNAVAILABLE' ? 'dependency' : 'internal',
      severity: 'error',
      messageKey: code,
      userAction: retryable ? 'retry' : 'contact_support',
      details: {},
      fieldErrors: []
    },
    supportId: ''
  }
}

function localServiceUnavailable(): ApiError {
  return new ApiError(
    syntheticProblem('SYS_LOCAL_SERVICE_UNAVAILABLE', 503, true, LOCAL_SERVICE_UNAVAILABLE_DETAIL)
  )
}

export function formatIfMatch(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const raw = typeof value === 'number' ? String(value) : value
  if (raw.trim().length === 0) return null
  return /^\d+$/.test(raw) ? `"${raw}"` : raw
}

export function newIdempotencyKey(): string {
  return `idem_${crypto.randomUUID()}`
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

export class ApiClient {
  private readonly getLocalServiceInfo: () => Promise<LocalServiceInfo>
  private readonly fetchImpl: FetchLike

  constructor(options: { getLocalServiceInfo: () => Promise<LocalServiceInfo>; fetchImpl?: FetchLike }) {
    this.getLocalServiceInfo = options.getLocalServiceInfo
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
  }

  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const response = await this.send(path, options, 'application/json')
    if (response.status === 204) return undefined as T
    const text = await response.text()
    if (text.length === 0) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      throw new ApiError(syntheticProblem('SYS_INTERNAL', 502, false, INVALID_JSON_DETAIL))
    }
  }

  async requestBlob(path: string, options: ApiRequestOptions = {}): Promise<Blob> {
    const response = await this.send(path, options, options.accept ?? 'image/*')
    return response.blob()
  }

  openStream(path: string, options: ApiRequestOptions = {}): Promise<Response> {
    return this.send(path, options, 'text/event-stream')
  }

  private async send(path: string, options: ApiRequestOptions, defaultAccept: string): Promise<Response> {
    let info: LocalServiceInfo
    try {
      info = await this.getLocalServiceInfo()
    } catch {
      throw localServiceUnavailable()
    }

    const headers = new Headers(options.headers)
    headers.set('authorization', `Bearer ${info.token}`)
    headers.set('accept', options.accept ?? defaultAccept)
    if (options.ifMatch !== undefined) {
      const ifMatch = formatIfMatch(options.ifMatch)
      if (ifMatch !== null) headers.set('if-match', ifMatch)
    }
    if (options.idempotencyKey !== undefined) {
      headers.set('idempotency-key', options.idempotencyKey)
    }

    let body: BodyInit | undefined
    if (options.body !== undefined) {
      if (options.body instanceof FormData) {
        body = options.body
      } else {
        headers.set('content-type', 'application/json')
        body = JSON.stringify(options.body)
      }
    }

    const controller = new AbortController()
    const callerSignal = options.signal
    let timer: ReturnType<typeof setTimeout> | undefined

    const abortFromCaller = (): void => {
      controller.abort()
    }

    if (callerSignal !== undefined) {
      if (callerSignal.aborted) controller.abort()
      else callerSignal.addEventListener('abort', abortFromCaller, { once: true })
    }
    if (options.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        controller.abort()
      }, options.timeoutMs)
    }

    const init: RequestInit = {
      method: options.method ?? 'GET',
      headers,
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal
    }
    if (body !== undefined) init.body = body

    try {
      const response = await this.fetchImpl(joinUrl(info.baseUrl, path), init)
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      if (!response.ok) throw await this.responseError(response)
      return response
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (callerSignal?.aborted) throw error
      throw localServiceUnavailable()
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (callerSignal !== undefined) callerSignal.removeEventListener('abort', abortFromCaller)
    }
  }

  private async responseError(response: Response): Promise<ApiError> {
    try {
      const problem = problemDetailsSchema.safeParse(await response.json())
      if (problem.success) return new ApiError(problem.data)
    } catch {
      // The body is intentionally ignored so non-problem responses cannot leak through the message.
    }
    return new ApiError(
      syntheticProblem(
        'SYS_INTERNAL',
        response.status,
        response.status >= 500,
        `本地服务返回了 HTTP ${response.status}。`
      )
    )
  }
}
