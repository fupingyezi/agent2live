import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/app'
import { serializeApiTimestamps } from '../src/http/api-json'

const STAMP = Date.UTC(2026, 10, 9, 4, 5, 6)

describe('API JSON timestamp boundary', () => {
  it('converts whitelisted millisecond fields recursively without mutating input', () => {
    const input = {
      id: 'chr_01J0000000000000000000000',
      createdAt: STAMP,
      rowVersion: 2,
      durationMs: 50,
      children: [{ updatedAt: STAMP + 1000, deletedAt: null }],
      metadata: { supportId: STAMP }
    }

    expect(serializeApiTimestamps(input)).toEqual({
      id: 'chr_01J0000000000000000000000',
      createdAt: '2026-11-09T04:05:06.000Z',
      rowVersion: 2,
      durationMs: 50,
      children: [{ updatedAt: '2026-11-09T04:05:07.000Z', deletedAt: null }],
      metadata: { supportId: STAMP }
    })
    expect(input.createdAt).toBe(STAMP)
  })

  it('serializes Date values and preserves non-timestamp numbers', () => {
    const result = serializeApiTimestamps({
      createdAt: new Date(STAMP),
      payload: { createdAt: STAMP, seq: 7 }
    }) as { createdAt: string; payload: { createdAt: string; seq: number } }
    expect(result.createdAt).toBe('2026-11-09T04:05:06.000Z')
    expect(result.payload).toEqual({ createdAt: '2026-11-09T04:05:06.000Z', seq: 7 })
  })

  it('is installed on replies built by buildApp', async () => {
    const app = buildApp({ token: 'test-token' })
    app.get('/__test__/timestamps', async () => ({
      createdAt: STAMP,
      nested: { updatedAt: STAMP + 1000, count: 1 }
    }))
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/__test__/timestamps',
        headers: { authorization: 'Bearer test-token' }
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        createdAt: '2026-11-09T04:05:06.000Z',
        nested: { updatedAt: '2026-11-09T04:05:07.000Z', count: 1 }
      })
    } finally {
      await app.close()
    }
  })

  it('allows last-event-id in CORS preflight', async () => {
    const app = buildApp({ token: 'test-token' })
    try {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/events',
        headers: {
          origin: 'null',
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization,last-event-id'
        }
      })
      expect(response.statusCode).toBe(204)
      expect(String(response.headers['access-control-allow-headers'])).toContain('last-event-id')
    } finally {
      await app.close()
    }
  })
})
