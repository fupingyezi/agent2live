import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSidecarEndpoint } from '@agent2live/contracts'
import { readEndpointFile, writeEndpointFile } from '../endpoint'

it('writes a 0600 atomic endpoint file with schema/pid/token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent2live-endpoint-'))
  const file = join(dir, 'endpoint.json')
  writeEndpointFile(file, {
    baseUrl: 'http://127.0.0.1:45678',
    token: 'secret-token-0123456789abcdefghijkl',
    pid: process.pid,
    startedAt: '2026-11-09T00:00:00.000Z'
  })
  const mode = statSync(file).mode & 0o777
  expect(mode).toBe(0o600)
  expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
    schemaVersion: 'endpoint/1',
    baseUrl: 'http://127.0.0.1:45678',
    token: 'secret-token-0123456789abcdefghijkl',
    pid: process.pid
  })
  const published = parseSidecarEndpoint(JSON.parse(readFileSync(file, 'utf8')))
  expect(published).toEqual({
    schemaVersion: 'endpoint/1',
    baseUrl: 'http://127.0.0.1:45678',
    token: 'secret-token-0123456789abcdefghijkl',
    pid: process.pid,
    startedAt: '2026-11-09T00:00:00.000Z'
  })
  expect(readEndpointFile(file).startedAt).toBe('2026-11-09T00:00:00.000Z')
  expect(() => readEndpointFile(join(dir, 'missing.json'))).toThrow(/endpoint/)
})

it('rejects an endpoint file written with a short token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent2live-endpoint-short-'))
  const file = join(dir, 'endpoint.json')
  writeFileSync(
    file,
    JSON.stringify({
      schemaVersion: 'endpoint/1',
      baseUrl: 'http://127.0.0.1:45678',
      token: 'secret-token',
      pid: process.pid,
      startedAt: '2026-11-09T00:00:00.000Z'
    }),
    'utf8'
  )
  expect(() => readEndpointFile(file)).toThrow(/at least 32/)
})
