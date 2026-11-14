import type { EndpointInfo } from './app'

export interface ServerEventFrame {
  id: number
  type: string
  schemaVersion: 'event/1'
  seq: number
  scope: { kind: string; id: string }
  payload: Record<string, unknown>
  requestId: string | null
  traceId: string | null
  createdAt: number
}

export interface SseConnection {
  events: ServerEventFrame[]
  waitFor(
    predicate: (event: ServerEventFrame) => boolean,
    timeoutMs?: number,
    label?: string
  ): Promise<ServerEventFrame>
  close(): void
}

function parseFrames(buffer: string): {
  frames: ServerEventFrame[]
  rest: string
} {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n\n')
  const rest = parts.pop() ?? ''
  const frames: ServerEventFrame[] = []
  for (const part of parts) {
    let id: number | null = null
    let event = ''
    const dataLines: string[] = []
    for (const line of part.split('\n')) {
      if (line.startsWith(':')) continue
      if (line.startsWith('id:')) id = Number(line.slice(3).trim())
      else if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    if (id === null || !event || dataLines.length === 0) continue
    const payload = JSON.parse(dataLines.join('\n')) as Omit<ServerEventFrame, 'id' | 'type'>
    if (payload.schemaVersion !== 'event/1') {
      throw new Error(`unexpected event schema ${String(payload.schemaVersion)}`)
    }
    if (payload.seq !== id) {
      throw new Error(`SSE id ${id} does not match payload seq ${payload.seq}`)
    }
    frames.push({ id, type: event, ...payload })
  }
  return { frames, rest }
}

export async function openSse(
  endpoint: EndpointInfo,
  options: { after?: number; lastEventId?: string } = {}
): Promise<SseConnection> {
  const after = options.after ?? 0
  if (!Number.isSafeInteger(after) || after < 0) throw new Error('after must be a non-negative integer')
  const controller = new AbortController()
  const headers = new Headers({
    authorization: `Bearer ${endpoint.token}`,
    accept: 'text/event-stream'
  })
  if (after > 0) {
    headers.set('last-event-id', options.lastEventId ?? String(after))
  }
  const url = new URL('/api/v1/events', endpoint.baseUrl)
  if (after > 0) url.searchParams.set('after', String(after))
  const response = await fetch(url, {
    headers,
    signal: controller.signal
  })
  if (!response.ok) {
    controller.abort()
    throw new Error(`SSE connection returned ${response.status}`)
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    controller.abort()
    throw new Error(`SSE connection returned ${contentType || 'no content type'}`)
  }

  const events: ServerEventFrame[] = []
  const waiters = new Set<() => void>()
  let rest = ''
  let closed = false
  let failure: Error | null = null

  const wake = (): void => {
    for (const waiter of [...waiters]) waiter()
  }

  const consume = async (): Promise<void> => {
    if (!response.body) throw new Error('SSE response has no body')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        rest += decoder.decode(value, { stream: true })
        const parsed = parseFrames(rest)
        rest = parsed.rest
        if (parsed.frames.length > 0) {
          events.push(...parsed.frames)
          wake()
        }
      }
      if (!closed) failure = new Error('SSE stream closed unexpectedly')
      wake()
    } catch (error) {
      if (!closed) failure = error instanceof Error ? error : new Error(String(error))
      wake()
    }
  }
  void consume()

  return {
    events,
    async waitFor(predicate, timeoutMs = 10_000, label = 'matching event') {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const found = events.find(predicate)
        if (found) return found
        if (failure) throw failure
        if (closed) throw new Error(`SSE connection closed before ${label}`)
        const remaining = deadline - Date.now()
        if (remaining <= 0) {
          throw new Error(
            `timed out waiting for ${label}; saw [${events.map((event) => event.type).join(', ')}]`
          )
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, Math.min(remaining, 250))
          waiters.add(() => {
            clearTimeout(timer)
            resolve()
          })
        })
      }
    },
    close() {
      closed = true
      controller.abort()
      wake()
    }
  }
}
