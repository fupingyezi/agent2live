import { describe, expect, it, vi } from 'vitest'
import type { FetchLike } from './client'
import {
  SseParser,
  ServerEventStream,
  buildSseRequest,
  parseServerEvent,
  type ServerEvent,
  type SseStatus
} from './sse'

const info = { baseUrl: 'http://127.0.0.1:43123', token: 'secret-token', pid: 123 }

function event(seq: number): ServerEvent {
  return {
    schemaVersion: 'event/1',
    seq,
    type: 'job.progress',
    scope: { kind: 'job', id: 'job_1' },
    payload: { percent: seq * 10 },
    requestId: 'req_1',
    traceId: 'trc_1',
    createdAt: 1_760_000_000_000 + seq
  }
}

function frame(seq: number): string {
  return `id: ${seq}\nevent: job.progress\ndata: ${JSON.stringify(event(seq))}\n\n`
}

function streamResponse(...chunks: string[]): Response {
  return new Response(chunks.join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  })
}

describe('SseParser', () => {
  it('is chunk-safe across CRLF, ignores comments, and joins multiline data', () => {
    const parser = new SseParser()
    expect(parser.push(': heartbeat\r')).toEqual([])
    expect(parser.push('\nid: 7\r\nevent: job.progress\r')).toEqual([])
    expect(parser.push('\ndata: {"a":\ndata: 1}\r\n\r\n')).toEqual([
      { id: '7', event: 'job.progress', data: '{"a":\n1}' }
    ])
  })

  it('flushes a final frame without a trailing blank line', () => {
    const parser = new SseParser()
    expect(parser.push('data: [DONE]')).toEqual([])
    expect(parser.flush()).toEqual([{ data: '[DONE]' }])
  })

  it('drops frames with no data and accepts null scope ids', () => {
    const parser = new SseParser()
    expect(parser.push('id: 1\n\n')).toEqual([])
    const value = { ...event(2), scope: { kind: 'system', id: null } }
    expect(parser.push(`data: ${JSON.stringify(value)}\n\n`)).toEqual([{ data: JSON.stringify(value) }])
  })
})

describe('parseServerEvent', () => {
  it('accepts event/1 and rejects malformed frames', () => {
    expect(parseServerEvent({ data: JSON.stringify(event(3)) })).toEqual(event(3))
    expect(parseServerEvent({ data: 'not-json' })).toBeNull()
    expect(parseServerEvent({ data: JSON.stringify({ ...event(3), seq: 0 }) })).toBeNull()
    expect(parseServerEvent({ data: JSON.stringify({ ...event(3), schemaVersion: 'event/2' }) })).toBeNull()
  })
})

describe('buildSseRequest', () => {
  it('keeps the token out of the URL and sends replay headers', () => {
    const controller = new AbortController()
    const request = buildSseRequest(info, 12, controller.signal)
    const url = new URL(request.url)
    expect(url.pathname).toBe('/api/v1/events')
    expect(url.searchParams.get('after')).toBe('12')
    expect(request.url).not.toContain(info.token)
    const headers = new Headers(request.init.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${info.token}`)
    expect(headers.get('last-event-id')).toBe('12')
    expect(headers.get('accept')).toBe('text/event-stream')
  })

  it('uses after=0 without Last-Event-ID for a fresh connection', () => {
    const request = buildSseRequest(info, 0, new AbortController().signal)
    expect(new URL(request.url).searchParams.get('after')).toBe('0')
    expect(new Headers(request.init.headers).get('last-event-id')).toBeNull()
  })
})

describe('ServerEventStream', () => {
  it('reconnects from the last sequence and dedupes replay', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const statuses: SseStatus[] = []
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, init })
      if (calls.length === 1) return streamResponse(frame(1), frame(2))
      return streamResponse(frame(1), frame(2), frame(3), frame(4))
    }

    const received: number[] = []
    let stream: ServerEventStream
    stream = new ServerEventStream({
      getServerInfo: async () => info,
      fetchImpl,
      sleep: async () => undefined,
      idleTimeoutMs: 1000,
      onStatus: (status) => statuses.push(status),
      onEvent: (serverEvent) => {
        received.push(serverEvent.seq)
        if (serverEvent.seq === 3) stream.stop()
      }
    })

    stream.start()
    await vi.waitFor(() => expect(received).toEqual([1, 2, 3]))
    expect(calls).toHaveLength(2)
    expect(new Headers(calls[1]!.init.headers).get('last-event-id')).toBe('2')
    expect(statuses).toContain('open')
    expect(statuses).toContain('reconnecting')
  })

  it('stops permanently on 401 instead of reconnect-looping', async () => {
    const statuses: SseStatus[] = []
    let fetches = 0
    const stream = new ServerEventStream({
      getServerInfo: async () => info,
      fetchImpl: async () => {
        fetches += 1
        return new Response('unauthorized', { status: 401 })
      },
      sleep: async () => undefined,
      onStatus: (status) => statuses.push(status),
      onEvent: () => undefined
    })

    stream.start()
    await vi.waitFor(() => expect(statuses).toContain('closed'))
    expect(fetches).toBe(1)
    stream.stop()
  })
})
