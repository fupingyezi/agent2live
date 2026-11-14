import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeSync
} from 'node:fs'
import { dirname, join } from 'node:path'

export interface BlobWrite {
  sha256: string
  storageKey: string
  byteSize: number
}

export class BlobStore {
  private readonly root: string
  private readonly tmp: string

  constructor(dataDir: string) {
    this.root = join(dataDir, 'blobs', 'sha256')
    this.tmp = join(dataDir, 'tmp')
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    mkdirSync(this.tmp, { recursive: true, mode: 0o700 })
  }

  put(bytes: Buffer): BlobWrite {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('BLOB_EMPTY')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const storageKey = `sha256/${sha256.slice(0, 2)}/${sha256}`
    const target = this.pathFor(sha256)
    if (existsSync(target)) {
      if (statSync(target).size !== bytes.length) throw new Error('BLOB_CORRUPT')
      return { sha256, storageKey, byteSize: bytes.length }
    }
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
    const tempFile = join(this.tmp, `blob-${process.pid}-${randomUUID()}`)
    const fd = openSync(tempFile, 'wx', 0o600)
    try {
      writeSync(fd, bytes)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    try {
      renameSync(tempFile, target)
    } catch (error) {
      rmSync(tempFile, { force: true })
      if (!existsSync(target)) throw error
    }
    return { sha256, storageKey, byteSize: bytes.length }
  }

  pathFor(sha256: string): string {
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('BLOB_INVALID_HASH')
    return join(this.root, sha256.slice(0, 2), sha256)
  }

  openRead(sha256: string): Buffer {
    this.verify(sha256)
    return readFileSync(this.pathFor(sha256))
  }

  verify(sha256: string): boolean {
    const bytes = readFileSync(this.pathFor(sha256))
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== sha256) throw new Error('BLOB_CHECKSUM_MISMATCH')
    return true
  }

  listHashes(): string[] {
    const result: string[] = []
    for (const prefix of readdirSync(this.root, { withFileTypes: true })) {
      if (!prefix.isDirectory() || !/^[0-9a-f]{2}$/.test(prefix.name)) continue
      for (const file of readdirSync(join(this.root, prefix.name), { withFileTypes: true })) {
        if (file.isFile() && /^[0-9a-f]{64}$/.test(file.name)) result.push(file.name)
      }
    }
    return result.sort()
  }
}
