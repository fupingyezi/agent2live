import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp } from '../app'
import { openDatabase } from '../db/client'
import { migrate } from '../db/migrate'
import type { EventStore } from '../events/store'

const migrations = fileURLToPath(new URL('../../migrations', import.meta.url))
const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

type SseReader = ReadableStreamDefaultReader<Uint8Array>

const decoder = new TextDecoder()

async function readSse(
  reader: SseReader,
  text: string,
  predicate: (value: string) => boolean,
  timeoutMs = 3000
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (!predicate(text)) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('SSE read deadline exceeded')
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('SSE read deadline exceeded')), remaining)
    })
    try {
      const result = await Promise.race([reader.read(), timeout])
      if (result.done) break
      text += decoder.decode(result.value, { stream: true })
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  if (!predicate(text)) throw new Error('SSE read deadline exceeded')
  return text
}

async function startAppWithDb(prefix: string): Promise<{ app: ReturnType<typeof buildApp>; base: string }> {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  const db = openDatabase(join(dir, 'app.sqlite'))
  migrate(db, migrations)
  const app = buildApp({ token: 't', db })
  cleanups.push(async () => {
    await app.close()
    db.close()
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('no port')
  return { app, base: `http://127.0.0.1:${address.port}` }
}

function eventStoreOf(app: ReturnType<typeof buildApp>): EventStore {
  return (app as unknown as { eventStore: EventStore }).eventStore
}

it('reports runtime module ABI so native mismatches are observable', async () => {
  const app = buildApp({ token: 't' })
  try {
    const res = await app.inject({
      url: '/health',
      headers: { authorization: 'Bearer t' }
    })
    const body = res.json()
    expect(body.runtime.modules).toBe(process.versions.modules)
    expect(body.runtime.node).toBe(process.versions.node)
    expect(body.data.db).toBe(false)
    expect(body.db).toBeUndefined()
  } finally {
    await app.close()
  }
})

it('reports db, migration, wal, and vector metadata when a database is configured', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent2live-health-'))
  const db = openDatabase(join(dir, 'app.sqlite'))
  migrate(db, migrations)
  const app = buildApp({ token: 't', db })
  cleanups.push(async () => {
    await app.close()
    db.close()
  })
  const res = await app.inject({ url: '/health', headers: { authorization: 'Bearer t' } })
  const body = res.json()
  expect(body.data).toEqual({ db: true, events: true })
  expect(body.db).toEqual({
    schemaVersion: 'sqlite/1',
    migration: '0004_backups',
    wal: true,
    vectorDim: 768
  })
})

it('streams event_log with SSE and replay cursor', async () => {
  const { app, base } = await startAppWithDb('agent2live-sse-')
  const store = eventStoreOf(app)
  store.append({ type: 'job.progress', scopeKind: 'job', scopeId: 'job_1', payload: { value: 1 } })
  store.append({ type: 'job.progress', scopeKind: 'job', scopeId: 'job_1', payload: { value: 2 } })

  const controller = new AbortController()
  try {
    const res = await fetch(`${base}/api/v1/events?after=0`, {
      headers: { authorization: 'Bearer t' },
      signal: controller.signal
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-request-id')).toBeTruthy()
    expect(res.headers.get('x-trace-id')).toBeTruthy()
    const text = await readSse(
      res.body!.getReader(),
      '',
      (value) => value.includes('event: job.progress') && value.includes('"value":2')
    )
    expect(text).toContain('id: 1\n')
    expect(text).toContain('id: 2\n')
    expect(text).toContain('event: job.progress\n')
  } finally {
    controller.abort()
  }
})

it('replays every event beyond one page in order without gaps', async () => {
  const { app, base } = await startAppWithDb('agent2live-sse-pages-')
  const store = eventStoreOf(app)
  const count = 505
  for (let value = 1; value <= count; value += 1) {
    store.append({ type: 'job.progress', scopeKind: 'job', scopeId: 'job_1', payload: { value } })
  }

  const controller = new AbortController()
  try {
    const res = await fetch(`${base}/api/v1/events?after=0`, {
      headers: { authorization: 'Bearer t' },
      signal: controller.signal
    })
    expect(res.status).toBe(200)
    const text = await readSse(
      res.body!.getReader(),
      '',
      (value) => [...value.matchAll(/^id: (\d+)$/gm)].length >= count
    )
    const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]))
    expect(ids).toEqual(Array.from({ length: count }, (_, index) => index + 1))
  } finally {
    controller.abort()
  }
}, 10_000)

it('delivers live events appended after the stream connects', async () => {
  const { app, base } = await startAppWithDb('agent2live-sse-live-')
  const store = eventStoreOf(app)

  const controller = new AbortController()
  try {
    const res = await fetch(`${base}/api/v1/events?after=0`, {
      headers: { authorization: 'Bearer t' },
      signal: controller.signal
    })
    expect(res.status).toBe(200)
    const reader = res.body!.getReader()
    const connected = await readSse(reader, '', (value) => value.includes(': connected'))
    expect(connected).not.toContain('id: ')

    store.append({ type: 'job.progress', scopeKind: 'job', scopeId: 'job_1', payload: { value: 1 } })
    const text = await readSse(reader, connected, (value) => value.includes('event: job.progress'))
    expect(text).toContain('id: 1\n')
    expect(text).toContain('"value":1')
  } finally {
    controller.abort()
  }
})

it('rejects an invalid SSE cursor with a stable problem code', async () => {
  const { base } = await startAppWithDb('agent2live-sse-invalid-')
  const res = await fetch(`${base}/api/v1/events?after=nope`, {
    headers: { authorization: 'Bearer t' }
  })
  expect(res.status).toBe(400)
  expect(res.headers.get('content-type')).toContain('application/problem+json')
  expect(res.headers.get('cache-control')).toBe('no-store')
  const body = (await res.json()) as {
    schemaVersion: string
    requestId: string
    traceId: string
    error: { code: string }
  }
  expect(body.schemaVersion).toBe('error/1')
  expect(body.error.code).toBe('REQUEST_INVALID')
  expect(res.headers.get('x-request-id')).toBe(body.requestId)
  expect(res.headers.get('x-trace-id')).toBe(body.traceId)
})

it('rejects an unauthenticated event stream with the stable auth problem', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent2live-sse-auth-'))
  const db = openDatabase(join(dir, 'app.sqlite'))
  migrate(db, migrations)
  const app = buildApp({ token: 't', db })
  cleanups.push(async () => {
    await app.close()
    db.close()
  })
  const res = await app.inject({ url: '/api/v1/events?after=0' })
  expect(res.statusCode).toBe(401)
  expect(res.headers['content-type']).toContain('application/problem+json')
  const body = res.json() as { schemaVersion: string; error: { code: string } }
  expect(body.schemaVersion).toBe('error/1')
  expect(body.error.code).toBe('AUTH_LOCAL_TOKEN_INVALID')
})

describe('health without a database', () => {
  it('keeps the Task 5 data flags false', async () => {
    const app = buildApp({ token: 't' })
    try {
      const res = await app.inject({ url: '/health', headers: { authorization: 'Bearer t' } })
      expect(res.json().data).toEqual({ db: false, events: false })
    } finally {
      await app.close()
    }
  })
})
