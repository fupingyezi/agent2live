import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from '../db/client'
import { migrate } from '../db/migrate'

const migrations = fileURLToPath(new URL('../../migrations', import.meta.url))

function tempDb(): { file: string; db: ReturnType<typeof openDatabase> } {
  const dir = mkdtempSync(join(tmpdir(), 'agent2live-db-'))
  const file = join(dir, 'app.sqlite')
  return { file, db: openDatabase(file) }
}

describe('database bootstrap', () => {
  it('enables WAL, foreign keys, and applies migrations idempotently', () => {
    const { db } = tempDb()
    try {
      const first = migrate(db, migrations)
      expect(first.applied).toContain('0001_init')
      expect(migrate(db, migrations).applied).toEqual([])
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
      expect(sqliteVecVersion(db)).toMatch(/^\d+\.\d+\.\d+$/)
    } finally {
      db.close()
    }
  })

  it('rejects a changed migration checksum', () => {
    const { db } = tempDb()
    const dir = mkdtempSync(join(tmpdir(), 'agent2live-migrations-'))
    const file = join(dir, '0001_init.sql')
    try {
      writeFileSync(file, 'create table t (id integer primary key);')
      migrate(db, dir)
      writeFileSync(file, 'create table t (id integer primary key, x text);')
      expect(() => migrate(db, dir)).toThrow(/checksum/)
    } finally {
      db.close()
    }
  })

  it('rolls back a failed migration without recording a partial version', () => {
    const { db } = tempDb()
    const dir = mkdtempSync(join(tmpdir(), 'agent2live-failed-migration-'))
    try {
      writeFileSync(join(dir, '0001_ok.sql'), 'create table ok (id integer primary key);')
      writeFileSync(join(dir, '0002_bad.sql'), 'create table broken (id integer primary key, );')
      expect(() => migrate(db, dir)).toThrow(/syntax/i)
      expect(db.prepare('select version from schema_migrations row').get()).toBeUndefined()
      expect(db.prepare("select name from sqlite_master where name = 'ok'").get()).toBeUndefined()
    } finally {
      db.close()
    }
  })
})

describe('vec0 and FTS5', () => {
  it('stores partitioned 768-d vectors and returns nearest within a space', () => {
    const { db } = tempDb()
    try {
      migrate(db, migrations)
      const insert = db.prepare(
        'insert into memory_vectors (space_id, memory_id, embedding) values (?, ?, ?)'
      )
      const vec = (value: number): Float32Array => new Float32Array(768).fill(value)
      insert.run('space_a', 'mem_1', vec(0.1))
      insert.run('space_a', 'mem_2', vec(0.9))
      insert.run('space_b', 'mem_3', vec(0.1))
      const rows = db
        .prepare(
          'select space_id, memory_id, distance from memory_vectors where space_id = ? and embedding match ? and k = ?'
        )
        .all('space_a', vec(0.1), 2) as Array<{ space_id: string; memory_id: string; distance: number }>
      expect(rows.map((row) => row.memory_id)).toEqual(['mem_1', 'mem_2'])
      expect(rows[0]!.distance).toBeLessThan(rows[1]!.distance)
      expect(rows.every((row) => row.space_id === 'space_a')).toBe(true)
      expect(() => insert.run('space_a', 'bad_dim', new Float32Array(767))).toThrow(/dimension/i)
    } finally {
      db.close()
    }
  })

  it('matches FTS5 unicode61 tokens', () => {
    const { db } = tempDb()
    try {
      migrate(db, migrations)
      db.prepare('insert into messages_fts (content) values (?)').run('alpha beta gamma')
      const rows = db.prepare("select rowid from messages_fts where messages_fts match 'beta'").all()
      expect(rows).toHaveLength(1)
      const none = db.prepare("select rowid from messages_fts where messages_fts match 'delta'").all()
      expect(none).toHaveLength(0)
    } finally {
      db.close()
    }
  })
})

describe('event_log', () => {
  it('assigns monotonic seq and supports replay after a cursor', () => {
    const { db } = tempDb()
    try {
      migrate(db, migrations)
      const insert = db.prepare(
        `insert into event_log (type, scope_kind, scope_id, payload_json, request_id, trace_id, created_at)
         values (?, ?, ?, ?, ?, ?, ?)`
      )
      insert.run('job.progress', 'job', 'job_1', '{"value":1}', 'req_1', 'trc_1', Date.now())
      insert.run('job.progress', 'job', 'job_1', '{"value":2}', 'req_2', 'trc_2', Date.now())
      const rows = db.prepare('select seq, payload_json from event_log where seq > ? order by seq').all(0)
      expect(rows).toHaveLength(2)
      expect(Number((rows[0] as { seq: number }).seq)).toBeLessThan(Number((rows[1] as { seq: number }).seq))
    } finally {
      db.close()
    }
  })
})

function sqliteVecVersion(db: ReturnType<typeof openDatabase>): string {
  const row = db.prepare('select vec_version() as version').get() as { version: string }
  // sqlite-vec 0.1.9 prefixes the semantic version with "v".
  return row.version.replace(/^v/, '')
}
