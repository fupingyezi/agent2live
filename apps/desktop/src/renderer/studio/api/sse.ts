import type { LocalServiceInfo } from '@agent2live/contracts'
import type { FetchLike } from './client'

export const SSE_BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000] as const
const DEFAULT_IDLE_TIMEOUT_MS = 45_000

export interface SseFrame {
  id?: string
  event?: string
  data: string
}

export class SseParser {
  private buffer = ''
  private id: string | null = null
  private event: string | null = null
  private data: string[] = []

  push(chunk: string): SseFrame[] {
    this.buffer += chunk
    const frames: SseFrame[] = []
    while (true) {
      const newline = /\r\n|\r|\n/.exec(this.buffer)
      if (!newline) break
      if (newline[0] === '\r' && newline.index === this.buffer.length - 1) break
      const line = this.buffer.slice(0, newline.index)
      this.buffer = this.buffer.slice(newline.index + newline[0].length)
      const frame = this.consumeLine(line)
      if (frame) frames.push(frame)
    }
    return frames
  }

  flush(): SseFrame[] {
    const frames = this.push('\n\n')
    this.buffer = ''
    return frames
  }

  private consumeLine(line: string): SseFrame | null {
    if (line.length === 0) {
      if (this.data.length === 0) {
        this.id = null
        this.event = null
        return null
      }
      const frame: SseFrame = { data: this.data.join('\n') }
      if (this.id !== null) frame.id = this.id
      if (this.event !== null) frame.event = this.event
      this.id = null
      this.event = null
      this.data = []
      return frame
    }

    if (line.startsWith(':')) return null

    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'data') {
      this.data.push(value)
    } else if (field === 'event') {
      this.event = value
    } else if (field === 'id' && !value.includes('\0')) {
      this.id = value
    }
    return null
  }
}

export interface ServerEvent {
  schemaVersion: 'event/1'
  seq: number
  type: string
  scope: { kind: string; id: string | null }
  payload: unknown
  requestId: string | null
  traceId: string | null
  createdAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

export function parseServerEvent(frame: SseFrame): ServerEvent | null {
  let value: unknown
  try {
    value = JSON.parse(frame.data)
  } catch {
    return null
  }
  if (!isRecord(value) || value.schemaVersion !== 'event/1') return null
  if (typeof value.seq !== 'number' || !Number.isSafeInteger(value.seq) || value.seq <= 0) return null
  if (typeof value.type !== 'string' || typeof value.createdAt !== 'number') return null
  if (!isRecord(value.scope) || typeof value.scope.kind !== 'string') return null
  const scopeId = value.scope.id
  if (scopeId !== undefined && scopeId !== null && typeof scopeId !== 'string') return null

  return {
    schemaVersion: 'event/1',
    seq: value.seq,
    type: value.type,
    scope: { kind: value.scope.kind, id: typeof scopeId === 'string' ? scopeId : null },
    payload: value.payload,
    requestId: typeof value.requestId === 'string' ? value.requestId : null,
    traceId: typeof value.traceId === 'string' ? value.traceId : null,
    createdAt: value.createdAt
  }
}

export function buildSseRequest(
  info: LocalServiceInfo,
  lastSeq: number,
  signal: AbortSignal
): { url: string; init: RequestInit } {
  const url = new URL('/api/v1/events', info.baseUrl)
  const after = Math.max(0, Math.trunc(lastSeq))
  url.searchParams.set('after', String(after))

  const headers = new Headers({
    authorization: `Bearer ${info.token}`,
    accept: 'text/event-stream'
  })
  if (after > 0) headers.set('last-event-id', String(after))

  return {
    url: url.toString(),
    init: {
      method: 'GET',
      headers,
      signal,
      cache: 'no-store',
      redirect: 'error'
    }
  }
}

export type SseStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface ServerEventStreamOptions {
  getLocalServiceInfo: () => Promise<LocalServiceInfo>
  onEvent: (event: ServerEvent) => void
  onStatus?: (status: SseStatus) => void
  fetchImpl?: FetchLike
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  idleTimeoutMs?: number
}

function abortError(): Error {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === 'AbortError'
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError())
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number,
  signal: AbortSignal
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const succeed = (result: ReadableStreamReadResult<Uint8Array>): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }
    const onAbort = (): void => {
      void reader.cancel().catch(() => undefined)
      fail(abortError())
    }

    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      void reader.cancel().catch(() => undefined)
      fail(new Error('SSE_IDLE_TIMEOUT'))
    }, idleTimeoutMs)
    reader.read().then(succeed, fail)
  })
}

export class ServerEventStream {
  private readonly options: ServerEventStreamOptions
  private readonly fetchImpl: FetchLike
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>
  private readonly idleTimeoutMs: number
  private lifecycle: AbortController | null = null
  private running = false
  private lastSeq = 0
  private attempt = 0

  constructor(options: ServerEventStreamOptions) {
    this.options = options
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
    this.sleep = options.sleep ?? abortableSleep
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.lifecycle = new AbortController()
    this.emit('connecting')
    void this.run(this.lifecycle.signal)
  }

  stop(): void {
    this.running = false
    this.lifecycle?.abort()
    this.lifecycle = null
  }

  private emit(status: SseStatus): void {
    try {
      this.options.onStatus?.(status)
    } catch {
      // UI status rendering must not break transport.
    }
  }

  private async run(signal: AbortSignal): Promise<void> {
    let firstAttempt = true
    while (!signal.aborted) {
      this.emit(firstAttempt ? 'connecting' : 'reconnecting')
      try {
        const info = await this.options.getLocalServiceInfo()
        if (signal.aborted) return
        const request = buildSseRequest(info, this.lastSeq, signal)
        const response = await this.fetchImpl(request.url, request.init)
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            this.running = false
            this.emit('closed')
            return
          }
          throw new Error(`SSE_HTTP_${response.status}`)
        }
        if (!response.body) throw new Error('SSE_BODY_MISSING')

        this.attempt = 0
        this.emit('open')
        await this.consume(response.body, signal)
        if (signal.aborted) return
        throw new Error('SSE_STREAM_ENDED')
      } catch (error) {
        if (signal.aborted || isAbortError(error)) return
        this.attempt += 1
        this.emit('reconnecting')
        const delay = SSE_BACKOFF_MS[Math.min(this.attempt - 1, SSE_BACKOFF_MS.length - 1)] ?? 15_000
        try {
          await this.sleep(delay, signal)
        } catch {
          return
        }
      } finally {
        firstAttempt = false
      }
    }
  }

  private async consume(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    const parser = new SseParser()
    try {
      while (!signal.aborted) {
        const { done, value } = await readWithIdleTimeout(reader, this.idleTimeoutMs, signal)
        if (done) break
        if (value) {
          for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
            if (signal.aborted) return
            this.handleFrame(frame)
          }
        }
      }
      if (signal.aborted) return
      for (const frame of parser.push(decoder.decode())) {
        if (signal.aborted) return
        this.handleFrame(frame)
      }
      for (const frame of parser.flush()) {
        if (signal.aborted) return
        this.handleFrame(frame)
      }
    } finally {
      reader.releaseLock()
    }
  }

  private handleFrame(frame: SseFrame): void {
    const serverEvent = parseServerEvent(frame)
    if (!serverEvent || serverEvent.seq <= this.lastSeq) return
    this.lastSeq = serverEvent.seq
    try {
      this.options.onEvent(serverEvent)
    } catch {
      // A consumer bug must not tear down the stream or lose replay position.
    }
  }
}
