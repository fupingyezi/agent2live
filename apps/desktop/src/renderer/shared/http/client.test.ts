import { buildProblem } from '@agent2live/contracts'
import { describe, expect, it, vi } from 'vitest'
import { ApiClient, ApiError, formatIfMatch, newIdempotencyKey } from './client'

const localServiceInfo = {
  baseUrl: 'http://127.0.0.1:43123',
  token: 'local-token',
  pid: 321
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('ApiClient', () => {
  it('adds bearer auth, accepts JSON, and never puts the token in the URL', async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    )
    const client = new ApiClient({
      getLocalServiceInfo: async () => ({
        baseUrl: 'http://127.0.0.1:43123',
        token: 'local-token',
        pid: 321
      }),
      fetchImpl
    })

    await expect(client.request<{ items: unknown[] }>('/api/v1/health')).resolves.toEqual({
      items: []
    })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('http://127.0.0.1:43123/api/v1/health')
    expect(url).not.toContain('local-token')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer local-token')
    expect(new Headers(init.headers).get('accept')).toBe('application/json')
    expect(init.method).toBe('GET')
    expect(init.cache).toBe('no-store')
    expect(init.redirect).toBe('error')
  })

  it('does not set JSON content-type for FormData', async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ id: 'ast_1' }), { status: 201 })
    )
    const client = new ApiClient({
      getLocalServiceInfo: async () => ({
        baseUrl: 'http://127.0.0.1:43123',
        token: 'local-token',
        pid: 321
      }),
      fetchImpl
    })
    const body = new FormData()
    body.append('file', new Blob(['x'], { type: 'image/png' }), 'x.png')

    await client.request('/api/v1/assets', { method: 'POST', body })
    const init = fetchImpl.mock.calls[0]![1]
    expect(new Headers(init.headers).get('content-type')).toBeNull()
    expect(init.body).toBe(body)
  })

  it('maps problem responses without exposing an HTML body', async () => {
    const client = new ApiClient({
      getLocalServiceInfo: async () => ({
        baseUrl: 'http://127.0.0.1:43123',
        token: 'local-token',
        pid: 321
      }),
      fetchImpl: async () => new Response('<html>secret path</html>', { status: 500 })
    })

    const error = await client.request('/api/v1/health').catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('SYS_INTERNAL')
    expect((error as ApiError).status).toBe(500)
    expect((error as ApiError).retryable).toBe(true)
    expect((error as ApiError).message).not.toContain('secret path')
  })

  it('preserves abort and applies the request timeout', async () => {
    const controller = new AbortController()
    controller.abort()
    const client = new ApiClient({
      getLocalServiceInfo: async () => ({
        baseUrl: 'http://127.0.0.1:43123',
        token: 'local-token',
        pid: 321
      }),
      fetchImpl: async (_url, init) => {
        expect(init.signal?.aborted).toBe(true)
        throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      }
    })

    await expect(client.request('/api/v1/slow', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError'
    })
  })

  it('joins base URLs and paths without duplicate slashes', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({ ok: true }))
    const client = new ApiClient({
      getLocalServiceInfo: async () => ({ ...localServiceInfo, baseUrl: 'http://127.0.0.1:43123///' }),
      fetchImpl
    })

    await client.request('///api/v1/health')
    expect(fetchImpl.mock.calls[0]![0]).toBe('http://127.0.0.1:43123/api/v1/health')
  })

  it('returns undefined for 204 and empty-body success responses', async () => {
    const responses = [new Response(null, { status: 204 }), new Response('', { status: 200 })]
    const client = new ApiClient({
      getLocalServiceInfo: async () => localServiceInfo,
      fetchImpl: async () => responses.shift()!
    })

    await expect(client.request('/api/v1/first')).resolves.toBeUndefined()
    await expect(client.request('/api/v1/second')).resolves.toBeUndefined()
  })

  it('maps invalid JSON success bodies to a safe SYS_INTERNAL error', async () => {
    const client = new ApiClient({
      getLocalServiceInfo: async () => localServiceInfo,
      fetchImpl: async () => new Response('<html>secret path</html>', { status: 200 })
    })

    const error = await client.request('/api/v1/health').catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('SYS_INTERNAL')
    expect((error as ApiError).status).toBe(502)
    expect((error as ApiError).retryable).toBe(false)
    expect((error as ApiError).message).not.toContain('secret path')
  })

  it('parses a valid problem response into ApiError fields', async () => {
    const problem = buildProblem({
      code: 'RESOURCE_STALE',
      requestId: 'req_1',
      traceId: 'trace_1',
      supportId: 'sup_1',
      instance: '/api/v1/assets/ast_1',
      detail: '当前数据已过期，请刷新后重试',
      details: { expected: 'v1', actual: 'v2' }
    })
    const client = new ApiClient({
      getLocalServiceInfo: async () => localServiceInfo,
      fetchImpl: async () =>
        new Response(JSON.stringify(problem), {
          status: 409,
          headers: { 'content-type': 'application/problem+json' }
        })
    })

    const error = await client.request('/api/v1/assets/ast_1').catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.problem).toEqual(problem)
    expect(apiError.code).toBe('RESOURCE_STALE')
    expect(apiError.status).toBe(409)
    expect(apiError.retryable).toBe(false)
    expect(apiError.userAction).toBe('refresh_resource')
    expect(apiError.fieldErrors).toEqual([])
    expect(apiError.requestId).toBe('req_1')
    expect(apiError.supportId).toBe('sup_1')
    expect(apiError.message).toBe(problem.detail)
  })

  it('maps an invalid problem body to a synthetic error that reflects the HTTP status', async () => {
    const client = new ApiClient({
      getLocalServiceInfo: async () => localServiceInfo,
      fetchImpl: async () => jsonResponse({ hello: 'world' }, 400)
    })

    const error = await client.request('/api/v1/assets').catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('SYS_INTERNAL')
    expect((error as ApiError).status).toBe(400)
    expect((error as ApiError).retryable).toBe(false)
    expect((error as ApiError).message).toBe('本地服务返回了 HTTP 400。')
  })

  it('maps a bridge failure to SYS_LOCAL_SERVICE_UNAVAILABLE without leaking the bridge error', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({}))
    const client = new ApiClient({
      getLocalServiceInfo: async () => {
        throw new Error('bridge exploded: secret path')
      },
      fetchImpl
    })

    const error = await client.request('/api/v1/health').catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('SYS_LOCAL_SERVICE_UNAVAILABLE')
    expect((error as ApiError).status).toBe(503)
    expect((error as ApiError).retryable).toBe(true)
    expect((error as ApiError).userAction).toBe('retry')
    expect((error as ApiError).message).not.toContain('bridge exploded')
    expect((error as ApiError).message).not.toContain('secret path')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('maps a supplied timeout to SYS_LOCAL_SERVICE_UNAVAILABLE instead of a raw AbortError', async () => {
    vi.useFakeTimers()
    try {
      const client = new ApiClient({
        getLocalServiceInfo: async () => localServiceInfo,
        fetchImpl: (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            })
          })
      })

      const pending = client.request('/api/v1/slow', { timeoutMs: 50 }).catch((reason: unknown) => reason)
      await vi.advanceTimersByTimeAsync(50)
      const error = await pending
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).code).toBe('SYS_LOCAL_SERVICE_UNAVAILABLE')
      expect((error as ApiError).status).toBe(503)
      expect((error as ApiError).retryable).toBe(true)
      expect((error as Error).name).toBe('ApiError')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not apply a timeout when timeoutMs is omitted', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    try {
      const client = new ApiClient({
        getLocalServiceInfo: async () => localServiceInfo,
        fetchImpl: (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            })
          })
      })

      let settled = false
      const pending = client.request('/api/v1/slow', { signal: controller.signal }).finally(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(120_000)
      expect(settled).toBe(false)
      controller.abort()
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('serializes JSON bodies and sets caller headers and conditional headers', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({ ok: true }))
    const client = new ApiClient({ getLocalServiceInfo: async () => localServiceInfo, fetchImpl })

    await client.request('/api/v1/assets', {
      method: 'PATCH',
      body: { name: 'Haru' },
      headers: { 'x-client': 'studio' },
      idempotencyKey: 'idem_explicit',
      ifMatch: 'W/"3"'
    })

    const init = fetchImpl.mock.calls[0]![1]
    expect(init.method).toBe('PATCH')
    expect(init.body).toBe(JSON.stringify({ name: 'Haru' }))
    const headers = new Headers(init.headers)
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('if-match')).toBe('W/"3"')
    expect(headers.get('idempotency-key')).toBe('idem_explicit')
    expect(headers.get('x-client')).toBe('studio')
  })

  it('omits conditional headers when they have no value', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({ ok: true }))
    const client = new ApiClient({ getLocalServiceInfo: async () => localServiceInfo, fetchImpl })

    await client.request('/api/v1/assets', { ifMatch: null })
    const headers = new Headers(fetchImpl.mock.calls[0]![1].headers)
    expect(headers.get('if-match')).toBeNull()
    expect(headers.get('idempotency-key')).toBeNull()
    expect(headers.get('content-type')).toBeNull()
  })

  it('openStream returns the untouched response with a text/event-stream accept', async () => {
    const response = new Response('data: hello\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    })
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => response)
    const client = new ApiClient({ getLocalServiceInfo: async () => localServiceInfo, fetchImpl })

    const stream = await client.openStream('/api/v1/events')
    expect(stream).toBe(response)
    expect(stream.bodyUsed).toBe(false)
    expect(new Headers(fetchImpl.mock.calls[0]![1].headers).get('accept')).toBe('text/event-stream')
  })

  it('requestBlob returns the response blob with an image accept', async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(new Blob(['image-bytes'], { type: 'image/png' }), { status: 200 })
    )
    const client = new ApiClient({ getLocalServiceInfo: async () => localServiceInfo, fetchImpl })

    const blob = await client.requestBlob('/api/v1/assets/ast_1/content')
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('image/png')
    expect(await blob.text()).toBe('image-bytes')
    expect(new Headers(fetchImpl.mock.calls[0]![1].headers).get('accept')).toBe('image/*')
  })

  it('honors an explicit accept type for zip downloads', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const client = new ApiClient({
      getLocalServiceInfo: async () => localServiceInfo,
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        return new Response(new Uint8Array([80, 75, 3, 4]), {
          status: 200,
          headers: { 'content-type': 'application/zip' }
        })
      }
    })
    const blob = await client.requestBlob('/api/v1/backups/bkp_1/download', {
      accept: 'application/zip'
    })
    expect(blob.size).toBe(4)
    expect(new Headers(calls[0]!.init.headers).get('accept')).toBe('application/zip')
  })
})

describe('formatIfMatch', () => {
  it('formats numbers and numeric strings as quoted ETags and rejects empty values', () => {
    expect(formatIfMatch(null)).toBeNull()
    expect(formatIfMatch(undefined)).toBeNull()
    expect(formatIfMatch('')).toBeNull()
    expect(formatIfMatch('   ')).toBeNull()
    expect(formatIfMatch('3')).toBe('"3"')
    expect(formatIfMatch(3)).toBe('"3"')
    expect(formatIfMatch('W/"3"')).toBe('W/"3"')
  })
})

describe('newIdempotencyKey', () => {
  it('returns unique keys with the idem_ prefix', () => {
    const keys = Array.from({ length: 20 }, () => newIdempotencyKey())
    for (const key of keys) expect(key.startsWith('idem_')).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
