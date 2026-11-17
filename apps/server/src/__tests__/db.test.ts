import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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

  it('adds failure-diagnostic columns used by generation recovery', () => {
    const { db } = tempDb()
    try {
      migrate(db, migrations)
      expect(columnNames(db, 'generation_jobs')).toContain('stage_before')
      expect(columnNames(db, 'provider_invocations')).toContain('error_detail_json')
    } finally {
      db.close()
    }
  })

  it('repairs generating projects only when no generation job is still active', () => {
    const { db } = tempDb()
    try {
      db.exec(`
        create table art_projects (
          id text primary key,
          stage text not null,
          active_version_id text,
          active_prompt_version_id text,
          updated_at integer not null,
          row_version integer not null
        );
        create table generation_jobs (
          id text primary key,
          art_project_id text not null,
          job_id text not null
        );
        create table generation_candidates (
          id text primary key,
          generation_job_id text not null
        );
        create table jobs (
          id text primary key,
          status text not null
        );
      `)
      const insertProject = db.prepare(
        `insert into art_projects
         (id, stage, active_version_id, active_prompt_version_id, updated_at, row_version)
         values (?, 'generating', ?, ?, 0, 1)`
      )
      insertProject.run('p_active', 'av_1', null)
      insertProject.run('p_candidates', null, 'pv_1')
      insertProject.run('p_prompt', null, 'pv_1')
      insertProject.run('p_draft', null, null)
      insertProject.run('p_running', null, 'pv_1')
      insertProject.run('p_done', null, 'pv_1')

      const insertGeneration = db.prepare(
        'insert into generation_jobs (id, art_project_id, job_id) values (?, ?, ?)'
      )
      insertGeneration.run('gj_candidates', 'p_candidates', 'job_candidates')
      insertGeneration.run('gj_running', 'p_running', 'job_running')
      insertGeneration.run('gj_done', 'p_done', 'job_done')
      db.prepare('insert into generation_candidates (id, generation_job_id) values (?, ?)').run(
        'gc_1',
        'gj_candidates'
      )
      const insertJob = db.prepare('insert into jobs (id, status) values (?, ?)')
      insertJob.run('job_candidates', 'failed')
      insertJob.run('job_running', 'retrying')
      insertJob.run('job_done', 'failed')

      db.exec(readFileSync(join(migrations, '0007_repair_stuck_generating_projects.sql'), 'utf8'))
      const rows = db.prepare('select id, stage, row_version from art_projects order by id').all()
      expect(rows).toEqual([
        { id: 'p_active', stage: 'art_version_active', row_version: 2 },
        { id: 'p_candidates', stage: 'candidate_review', row_version: 2 },
        { id: 'p_done', stage: 'prompt_ready', row_version: 2 },
        { id: 'p_draft', stage: 'prompt_draft', row_version: 2 },
        { id: 'p_prompt', stage: 'prompt_ready', row_version: 2 },
        { id: 'p_running', stage: 'generating', row_version: 1 }
      ])
    } finally {
      db.close()
    }
  })

  it('normalizes legacy seedream endpoint base URLs to their API root', () => {
    const { db } = tempDb()
    try {
      migrate(db, migrations)
      const insert = db.prepare(
        `insert into provider_connections
         (id, label, kind, adapter, base_url, model, capabilities_json, enabled, created_at, updated_at)
         values (?, ?, ?, ?, ?, 'model', '{}', 0, 0, 0)`
      )
      insert.run(
        'conn_doubled',
        'doubled',
        'image',
        'seedream',
        'https://ark.cn-beijing.volces.com/api/v3/images/generations'
      )
      insert.run(
        'conn_trailing',
        'trailing',
        'image',
        'seedream',
        'https://ark.cn-beijing.volces.com/api/v3/images/generations/'
      )
      insert.run(
        'conn_repeated',
        'repeated',
        'image',
        'seedream',
        'https://ark.cn-beijing.volces.com/api/v3/images/generations/images/generations'
      )
      insert.run('conn_root', 'root', 'image', 'seedream', 'https://ark.cn-beijing.volces.com/api/v3')
      insert.run(
        'conn_chat',
        'chat',
        'chat',
        'openai-compatible',
        'https://api.example.com/images/generations'
      )
      db.exec(readFileSync(join(migrations, '0005_normalize_seedream_base_url.sql'), 'utf8'))
      const rows = db.prepare('select id, base_url from provider_connections order by id').all() as Array<{
        id: string
        base_url: string
      }>
      expect(rows).toEqual([
        { id: 'conn_chat', base_url: 'https://api.example.com/images/generations' },
        { id: 'conn_doubled', base_url: 'https://ark.cn-beijing.volces.com/api/v3' },
        { id: 'conn_repeated', base_url: 'https://ark.cn-beijing.volces.com/api/v3' },
        { id: 'conn_root', base_url: 'https://ark.cn-beijing.volces.com/api/v3' },
        { id: 'conn_trailing', base_url: 'https://ark.cn-beijing.volces.com/api/v3' }
      ])
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

function columnNames(db: ReturnType<typeof openDatabase>, table: string): string[] {
  return (db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>).map(
    (column) => column.name
  )
}
