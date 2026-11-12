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
  expect(body.db).toEqual({ schemaVersion: 'sqlite/1', migration: '0001_init', wal: true, vectorDim: 768 })
})

it('streams event_log with SSE and replay cursor', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent2live-sse-'))
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
  const base = `http://127.0.0.1:${address.port}`
  const store = (app as unknown as { eventStore: EventStore }).eventStore
  store.append({ type: 'job.progress', scopeKind: 'job', scopeId: 'job_1', payload: { value: 1 } })
  store.append({ type: 'job.progress', scopeKind: 'job', scopeId: 'job_1', payload: { value: 2 } })

  const controller = new AbortController()
  const res = await fetch(`${base}/api/v1/events?after=0`, {
    headers: { authorization: 'Bearer t' },
    signal: controller.signal
  })
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/event-stream')
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let text = ''
  while (!text.includes('event: job.progress') || !text.includes('"value":2')) {
    const { value, done } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }
  controller.abort()
  expect(text).toContain('id: 1\n')
  expect(text).toContain('id: 2\n')
  expect(text).toContain('event: job.progress\n')
})

it('rejects an invalid SSE cursor with a stable problem code', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent2live-sse-invalid-'))
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
  const res = await fetch(`http://127.0.0.1:${address.port}/api/v1/events?after=nope`, {
    headers: { authorization: 'Bearer t' }
  })
  expect(res.status).toBe(400)
  expect(res.headers.get('content-type')).toContain('application/problem+json')
  const body = (await res.json()) as { schemaVersion: string; error: { code: string } }
  expect(body.schemaVersion).toBe('error/1')
  expect(body.error.code).toBe('REQUEST_INVALID')
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
