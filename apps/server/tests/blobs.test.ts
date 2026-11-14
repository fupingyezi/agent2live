import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BlobStore } from '../src/services/blobs'

describe('BlobStore', () => {
  it('writes content-addressed 0600 files atomically and deduplicates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent2live-blobs-'))
    const store = new BlobStore(dir)
    const bytes = Buffer.from('hello agent2live')
    const first = store.put(bytes)
    const second = store.put(Buffer.from(bytes))
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(first.storageKey).toBe(`sha256/${first.sha256.slice(0, 2)}/${first.sha256}`)
    expect(second).toEqual(first)
    const stat = statSync(store.pathFor(first.sha256))
    expect(stat.mode & 0o777).toBe(0o600)
    expect(readFileSync(store.pathFor(first.sha256))).toEqual(bytes)
    expect(store.listHashes()).toEqual([first.sha256])
  })

  it('rejects path traversal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent2live-blobs-'))
    const store = new BlobStore(dir)
    expect(() => store.pathFor('../app.sqlite')).toThrow(/invalid/i)
  })

  it('detects a tampered blob', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent2live-blobs-'))
    const store = new BlobStore(dir)
    const write = store.put(Buffer.from('x'))
    writeFileSync(store.pathFor(write.sha256), 'tampered')
    expect(() => store.verify(write.sha256)).toThrow(/checksum/i)
  })
})
