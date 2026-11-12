import { ProviderError, providerHttpError } from './errors'
import type { ProviderRequestContext } from './types'

const MAX_TEXT_BYTES = 2 * 1024 * 1024

export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const date = Date.parse(value)
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now())
}

interface TimedSignal {
  signal: AbortSignal
  didTimeout(): boolean
  cleanup(): void
}

function timedSignal(context: ProviderRequestContext, fallbackMs: number): TimedSignal {
  const controller = new AbortController()
  let timedOut = false
  const timeoutMs = context.timeoutMs ?? fallbackMs
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onAbort = (): void => controller.abort()
  if (context.signal) {
    if (context.signal.aborted) controller.abort()
    else context.signal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup() {
      clearTimeout(timer)
      context.signal?.removeEventListener('abort', onAbort)
    }
  }
}

async function fetchChecked(
  url: string,
  init: RequestInit,
  context: ProviderRequestContext,
  fallbackTimeoutMs: number
): Promise<Response> {
  const timed = timedSignal(context, fallbackTimeoutMs)
  try {
    return await fetch(url, { ...init, signal: timed.signal })
  } catch (error) {
    if (context.signal?.aborted) {
      throw new ProviderError('PROVIDER_CANCELLED', 'provider request cancelled')
    }
    if (timed.didTimeout()) {
      throw new ProviderError('PROVIDER_TIMEOUT', 'provider request timed out')
    }
    throw new ProviderError(
      'PROVIDER_UNAVAILABLE',
      error instanceof Error ? `provider request failed: ${error.name}` : 'provider request failed'
    )
  } finally {
    timed.cleanup()
  }
}

async function errorFromResponse(response: Response): Promise<ProviderError> {
  let body = ''
  try {
    body = (await response.text()).slice(0, 4096)
  } catch {
    body = ''
  }
  return providerHttpError(response.status, body, parseRetryAfter(response.headers.get('retry-after')))
}

function authHeaders(apiKey: string, contentType: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    'content-type': contentType,
    accept: 'application/json'
  }
}

export async function postJson(
  url: string,
  apiKey: string,
  body: unknown,
  context: ProviderRequestContext,
  timeoutMs = 60_000
): Promise<{ json: Record<string, unknown>; headers: Headers }> {
  const response = await fetchChecked(
    url,
    {
      method: 'POST',
      headers: authHeaders(apiKey, 'application/json'),
      body: JSON.stringify(body)
    },
    context,
    timeoutMs
  )
  if (!response.ok) throw await errorFromResponse(response)
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
    throw new ProviderError('PROVIDER_INVALID_RESPONSE', 'provider response too large')
  }
  try {
    const json = JSON.parse(text) as unknown
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      throw new Error('not an object')
    }
    return { json: json as Record<string, unknown>, headers: response.headers }
  } catch {
    throw new ProviderError('PROVIDER_INVALID_RESPONSE', 'provider returned invalid JSON')
  }
}

export async function fetchImageBytes(
  url: string,
  context: ProviderRequestContext,
  options: { maxBytes: number; timeoutMs?: number }
): Promise<{ bytes: Buffer; contentType: string | null }> {
  const response = await fetchChecked(url, { method: 'GET' }, context, options.timeoutMs ?? 60_000)
  if (!response.ok) throw await errorFromResponse(response)
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > options.maxBytes) {
    throw new ProviderError('PROVIDER_INVALID_RESPONSE', 'provider image too large')
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length === 0 || bytes.length > options.maxBytes) {
    throw new ProviderError('PROVIDER_INVALID_RESPONSE', 'provider image size invalid')
  }
  return { bytes, contentType: response.headers.get('content-type') }
}
