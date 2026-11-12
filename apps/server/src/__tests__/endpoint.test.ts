import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readEndpointFile, writeEndpointFile } from '../endpoint'

it('writes a 0600 atomic endpoint file with schema/pid/token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent2live-endpoint-'))
  const file = join(dir, 'endpoint.json')
  writeEndpointFile(file, {
    baseUrl: 'http://127.0.0.1:45678',
    token: 'secret-token',
    pid: process.pid,
    startedAt: '2026-11-09T00:00:00.000Z'
  })
  const mode = statSync(file).mode & 0o777
  expect(mode).toBe(0o600)
  expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
    schemaVersion: 'endpoint/1',
    baseUrl: 'http://127.0.0.1:45678',
    token: 'secret-token',
    pid: process.pid
  })
  expect(readEndpointFile(file).token).toBe('secret-token')
  expect(() => readEndpointFile(join(dir, 'missing.json'))).toThrow(/endpoint/)
})
