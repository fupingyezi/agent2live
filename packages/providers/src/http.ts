import { isBlockedProviderHost } from '@agent2live/contracts'
import { ProviderError, providerHttpError, safeProviderCode } from './errors'
import type { ProviderRequestContext } from './types'

const MAX_TEXT_BYTES = 2 * 1024 * 1024

const LOOPBACK_IMAGE_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
const MAX_IMAGE_REDIRECTS = 4

type Ipv4 = readonly [number, number, number, number]

function invalidImageUrl(message: string): ProviderError {
  return new ProviderError('PROVIDER_INVALID_RESPONSE', message)
}

function parseIpv4(host: string): Ipv4 | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!match) return null
  const octets = match.slice(1).map(Number)
  if (octets.some((octet) => octet > 255)) return null
  return [octets[0]!, octets[1]!, octets[2]!, octets[3]!]
}

function isPrivateIpv4([first, second]: Ipv4): boolean {
  return (
    first === 0 ||
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  )
}

function parseIpv6(host: string): number[] | null {
  if (!host.startsWith('[') || !host.endsWith(']')) return null
  const literal = host.slice(1, -1)
  if (!literal.includes(':')) return null
  const halves = literal.split('::')
  if (halves.length > 2) return null
  const parseGroups = (value: string): number[] | null =>
    value === ''
      ? []
      : value
          .split(':')
          .map((group) => (/^[0-9a-f]{1,4}$/i.test(group) ? Number.parseInt(group, 16) : Number.NaN))
  const head = parseGroups(halves[0]!)
  const tail = halves.length === 2 ? parseGroups(halves[1]!) : []
  if (!head || !tail) return null
  const missing = halves.length === 2 ? 8 - head.length - tail.length : 0
  if (missing < 0) return null
  const groups = halves.length === 2 ? [...head, ...new Array<number>(missing).fill(0), ...tail] : head
  if (groups.length !== 8) return null
  if (groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) return null
  return groups
}

function embeddedIpv4(groups: number[]): Ipv4 | null {
  const leadingZeros = (count: number): boolean => groups.slice(0, count).every((group) => group === 0)
  let value: number
  if (leadingZeros(5) && groups[5] === 0xffff) {
    // IPv4-mapped: ::ffff:a.b.c.d
    value = groups[6]! * 0x10000 + groups[7]!
  } else if (leadingZeros(4) && groups[4] === 0xffff) {
    // IPv4-translated: ::ffff:0:a.b.c.d
    value = groups[6]! * 0x10000 + groups[7]!
  } else if (leadingZeros(6)) {
    // Deprecated IPv4-compatible: ::a.b.c.d (includes :: and ::1)
    value = groups[6]! * 0x10000 + groups[7]!
  } else {
    return null
  }
  return [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

function isLoopbackImageHost(hostname: string): boolean {
  return LOOPBACK_IMAGE_HOSTS.has(hostname.toLowerCase().replace(/\.+$/, ''))
}

function isBlockedImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, '')
  if (LOOPBACK_IMAGE_HOSTS.has(host)) return false
  if (host.endsWith('.localhost')) return true
  if (isBlockedProviderHost(host)) return true
  const ipv4 = parseIpv4(host)
  if (ipv4) return isPrivateIpv4(ipv4)
  const groups = parseIpv6(host)
  if (!groups) return false
  const embedded = embeddedIpv4(groups)
  if (embedded) return isPrivateIpv4(embedded)
  if ((groups[0]! & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  if ((groups[0]! & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((groups[0]! & 0xff00) === 0xff00) return true // ff00::/8 multicast
  return false
}

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
    const cause = typeof error === 'object' && error !== null ? (error as { cause?: unknown }).cause : null
    const causeCode =
      typeof cause === 'object' && cause !== null
        ? safeProviderCode((cause as { code?: unknown }).code)
        : null
    throw new ProviderError(
      'PROVIDER_UNAVAILABLE',
      error instanceof Error ? `provider request failed: ${error.name}` : 'provider request failed',
      { providerCode: causeCode }
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

async function readJsonResponse(
  response: Response
): Promise<{ json: Record<string, unknown>; headers: Headers }> {
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
  return readJsonResponse(response)
}

export async function getJson(
  url: string,
  apiKey: string,
  context: ProviderRequestContext,
  timeoutMs = 30_000
): Promise<{ json: Record<string, unknown>; headers: Headers }> {
  const response = await fetchChecked(
    url,
    { method: 'GET', headers: authHeaders(apiKey, 'application/json') },
    context,
    timeoutMs
  )
  if (!response.ok) throw await errorFromResponse(response)
  return readJsonResponse(response)
}

export function assertSafeImageUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw invalidImageUrl('provider returned an invalid image url')
  }
  if (url.username || url.password) {
    throw invalidImageUrl('provider image url must not include credentials')
  }
  const hostname = url.hostname.toLowerCase().replace(/\.+$/, '')
  if (isBlockedImageHost(hostname)) {
    throw invalidImageUrl('provider image url targets a blocked host')
  }
  const loopback = LOOPBACK_IMAGE_HOSTS.has(hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw invalidImageUrl('provider image url must use HTTPS or loopback HTTP')
  }
}

async function fetchImageResponse(
  url: string,
  context: ProviderRequestContext,
  timeoutMs: number
): Promise<Response> {
  let currentUrl = url
  for (let redirects = 0; ; redirects += 1) {
    assertSafeImageUrl(currentUrl)
    const response = await fetchChecked(currentUrl, { method: 'GET', redirect: 'manual' }, context, timeoutMs)
    if (response.status < 300 || response.status >= 400) return response
    if (redirects >= MAX_IMAGE_REDIRECTS) {
      throw invalidImageUrl('provider image redirect limit exceeded')
    }
    const location = response.headers.get('location')
    if (!location) {
      throw invalidImageUrl('provider image redirect missing location')
    }
    let next: URL
    try {
      next = new URL(location, currentUrl)
    } catch {
      throw invalidImageUrl('provider image redirect location invalid')
    }
    assertSafeImageUrl(next.toString())
    const currentIsLoopback = isLoopbackImageHost(new URL(currentUrl).hostname)
    if (!currentIsLoopback && isLoopbackImageHost(next.hostname)) {
      throw invalidImageUrl('provider image redirect must not target a loopback host')
    }
    await response.body?.cancel().catch(() => {})
    currentUrl = next.toString()
  }
}

export async function fetchImageBytes(
  url: string,
  context: ProviderRequestContext,
  options: { maxBytes: number; timeoutMs?: number }
): Promise<{ bytes: Buffer; contentType: string | null }> {
  const response = await fetchImageResponse(url, context, options.timeoutMs ?? 60_000)
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
