import type { FastifyReply, FastifyRequest } from 'fastify'
import { buildProblem } from '@agent2live/contracts'
import type { EventStore } from './store'
import { formatSseFrame } from './format'

export function openEventStream(request: FastifyRequest, reply: FastifyReply, store: EventStore): void {
  reply.hijack()
  const raw = reply.raw
  const afterRaw = (request.query as { after?: string } | undefined)?.after ?? '0'
  const after = Number(afterRaw)
  if (!Number.isSafeInteger(after) || after < 0) {
    const problem = buildProblem({
      code: 'REQUEST_INVALID',
      requestId: request.id,
      traceId: request.traceId,
      instance: request.url,
      detail: 'after must be a non-negative integer'
    })
    raw.statusCode = 400
    raw.setHeader('content-type', 'application/problem+json')
    raw.end(JSON.stringify(problem))
    return
  }

  raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  })
  raw.write(': connected\n\n')

  let lastSeq = after
  let closed = false
  let live = false
  const backlog: Array<ReturnType<EventStore['append']>> = []

  const write = (event: ReturnType<EventStore['append']>): void => {
    if (closed || event.seq <= lastSeq) return
    raw.write(formatSseFrame(event))
    lastSeq = event.seq
  }

  const unsubscribe = store.subscribe((event) => {
    if (!live) backlog.push(event)
    else write(event)
  })

  for (const event of store.listAfter(after)) write(event)
  live = true
  for (const event of backlog) write(event)

  const heartbeat = setInterval(() => {
    if (!closed) raw.write(': ping\n\n')
  }, 15_000)
  heartbeat.unref()

  const close = (): void => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    unsubscribe()
    raw.end()
  }
  request.raw.on('close', close)
  request.raw.on('error', close)
}
