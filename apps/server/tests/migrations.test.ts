import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../src/db/client'
import { migrate } from '../src/db/migrate'
import { fileURLToPath } from 'node:url'
import { createTestDatabase } from './helpers/app'

const migrations = fileURLToPath(new URL('../migrations', import.meta.url))
let db: Database.Database | null = null

afterEach(() => {
  db?.close()
  db = null
})

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'agent2live-p1-'))
  db = openDatabase(join(dir, 'app.sqlite'))
  migrate(db, migrations)
  return db
}

describe('Phase 1 migrations', () => {
  it('applies migrations in version order', () => {
    const database = fresh()
    const names = (
      database.prepare('select version from schema_migrations order by version').all() as Array<{
        version: string
      }>
    ).map((row) => row.version)
    expect(names).toEqual([
      '0001_init',
      '0002_core_domain',
      '0003_prompt_art',
      '0004_backups',
      '0005_normalize_seedream_base_url',
      '0006_generation_failure_diagnostics',
      '0007_repair_stuck_generating_projects'
    ])
    expect(database.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(migrate(database, migrations).applied).toEqual([])
  })

  it('enforces one active draft and one fork child', () => {
    const database = fresh()
    database
      .prepare('insert into characters (id,title,created_at,updated_at,row_version) values (?,?,?,?,1)')
      .run('chr_01J00000000000000000000000', 'A', 1, 1)
    database
      .prepare(
        'insert into art_projects (id,character_id,title,stage,created_at,updated_at,row_version) values (?,?,?,?,?,?,1)'
      )
      .run('artp_01J00000000000000000000000', 'chr_01J00000000000000000000000', 'main', 'idea_draft', 1, 1)
    database
      .prepare(
        'insert into art_projects (id,character_id,title,stage,created_at,updated_at,row_version) values (?,?,?,?,?,?,1)'
      )
      .run('artp_01J00000000000000000000001', 'chr_01J00000000000000000000000', 'parent', 'idea_draft', 1, 1)
    const insert = database.prepare(
      'insert into prompt_drafts (id,art_project_id,revision,status,state_json,content_hash,created_at,updated_at,row_version) values (?,?,?,?,?,?,?,?,1)'
    )
    insert.run(
      'pd_01J00000000000000000000000',
      'artp_01J00000000000000000000000',
      1,
      'active',
      '{}',
      'a'.repeat(64),
      1,
      1
    )
    expect(() =>
      insert.run(
        'pd_01J00000000000000000000001',
        'artp_01J00000000000000000000000',
        2,
        'active',
        '{}',
        'b'.repeat(64),
        1,
        1
      )
    ).toThrow(/UNIQUE/i)
    const fork = database.prepare(
      'insert into project_forks (id,child_project_id,parent_project_id,root_project_id,source_kind,source_version_id,source_hash,branch_label,status,created_at) values (?,?,?,?,?,?,?,?,?,?)'
    )
    fork.run(
      'frk_01J00000000000000000000000',
      'artp_01J00000000000000000000000',
      'artp_01J00000000000000000000001',
      'artp_01J00000000000000000000001',
      'prompt_version',
      'pv_x',
      'a'.repeat(64),
      'x',
      'active',
      1
    )
    expect(() =>
      fork.run(
        'frk_01J00000000000000000000001',
        'artp_01J00000000000000000000000',
        'artp_01J00000000000000000000001',
        'artp_01J00000000000000000000001',
        'prompt_version',
        'pv_x',
        'a'.repeat(64),
        'x',
        'active',
        1
      )
    ).toThrow(/UNIQUE/i)
  })

  it('rejects updates and deletes of committed versions', () => {
    const database = fresh()
    database
      .prepare('insert into characters (id,title,created_at,updated_at,row_version) values (?,?,?,?,1)')
      .run('chr_01J00000000000000000000000', 'A', 1, 1)
    database
      .prepare(
        'insert into art_projects (id,character_id,title,stage,created_at,updated_at,row_version) values (?,?,?,?,?,?,1)'
      )
      .run('artp_01J00000000000000000000000', 'chr_01J00000000000000000000000', 'main', 'idea_draft', 1, 1)
    database
      .prepare(
        'insert into prompt_drafts (id,art_project_id,revision,status,state_json,content_hash,created_at,updated_at,row_version) values (?,?,?,?,?,?,?,?,1)'
      )
      .run(
        'pd_01J00000000000000000000000',
        'artp_01J00000000000000000000000',
        1,
        'active',
        '{}',
        'a'.repeat(64),
        1,
        1
      )
    database
      .prepare(
        'insert into prompt_input_submissions (id,art_project_id,draft_id,revision,requirements_json,created_at,row_version) values (?,?,?,?,?,?,1)'
      )
      .run(
        'pin_01J00000000000000000000000',
        'artp_01J00000000000000000000000',
        'pd_01J00000000000000000000000',
        1,
        '[]',
        1
      )
    database
      .prepare(
        'insert into prompt_versions (id,art_project_id,input_submission_id,content_json,content_hash,version_number,created_at) values (?,?,?,?,?,?,?)'
      )
      .run(
        'pv_01J00000000000000000000000',
        'artp_01J00000000000000000000000',
        'pin_01J00000000000000000000000',
        '{}',
        'a'.repeat(64),
        1,
        1
      )
    expect(() =>
      database
        .prepare('update prompt_versions set content_hash = ? where id = ?')
        .run('b'.repeat(64), 'pv_01J00000000000000000000000')
    ).toThrow(/PROMPT_VERSION_IMMUTABLE/i)
    expect(() =>
      database.prepare('delete from prompt_versions where id = ?').run('pv_01J00000000000000000000000')
    ).toThrow(/PROMPT_VERSION_IMMUTABLE/i)
  })

  it('keeps character brief versions immutable and validates the active pointer', () => {
    const database = fresh()
    database
      .prepare('insert into characters (id,title,created_at,updated_at,row_version) values (?,?,?,?,1)')
      .run('chr_01J00000000000000000000000', 'A', 1, 1)
    database
      .prepare('insert into characters (id,title,created_at,updated_at,row_version) values (?,?,?,?,1)')
      .run('chr_01J00000000000000000000001', 'B', 1, 1)
    database
      .prepare(
        'insert into character_brief_versions (id,character_id,parent_version_id,schema_version,content_json,content_hash,source_kind,created_at) values (?,?,?,?,?,?,?,?)'
      )
      .run(
        'cbv_01J00000000000000000000000',
        'chr_01J00000000000000000000000',
        null,
        'character-brief/1',
        '{}',
        'a'.repeat(64),
        'user',
        1
      )
    database
      .prepare('update characters set active_brief_version_id = ? where id = ?')
      .run('cbv_01J00000000000000000000000', 'chr_01J00000000000000000000000')
    expect(() =>
      database
        .prepare('update characters set active_brief_version_id = ? where id = ?')
        .run('cbv_01J00000000000000000000000', 'chr_01J00000000000000000000001')
    ).toThrow(/ACTIVE_BRIEF_CHARACTER_MISMATCH/i)
    expect(() =>
      database
        .prepare('update character_brief_versions set content_hash = ? where id = ?')
        .run('b'.repeat(64), 'cbv_01J00000000000000000000000')
    ).toThrow(/CHARACTER_BRIEF_IMMUTABLE/i)
    expect(() =>
      database
        .prepare('delete from character_brief_versions where id = ?')
        .run('cbv_01J00000000000000000000000')
    ).toThrow(/CHARACTER_BRIEF_IMMUTABLE/i)
  })

  it('enforces art_version reference primary, asset, and order uniqueness', () => {
    const database = fresh()
    for (const id of ['ast_01J00000000000000000000000', 'ast_01J00000000000000000000001']) {
      database
        .prepare(
          'insert into assets (id,sha256,media_type,byte_size,storage_key,metadata_json,created_at) values (?,?,?,?,?,?,?)'
        )
        .run(id, id.slice(-1).repeat(64), 'image/png', 1, `blobs/${id}`, '{}', 1)
    }
    const insert = database.prepare(
      'insert into asset_links (id,asset_id,owner_type,owner_id,role,weight,sort_order,is_primary,created_at) values (?,?,?,?,?,?,?,?,?)'
    )
    insert.run(
      'lnk_01J00000000000000000000000',
      'ast_01J00000000000000000000000',
      'art_version',
      'artv_01J00000000000000000000000',
      'identity_reference',
      1,
      0,
      1,
      1
    )
    expect(() =>
      insert.run(
        'lnk_01J00000000000000000000001',
        'ast_01J00000000000000000000001',
        'art_version',
        'artv_01J00000000000000000000000',
        'style_reference',
        1,
        0,
        1,
        1
      )
    ).toThrow(/UNIQUE/i)
    insert.run(
      'lnk_01J00000000000000000000002',
      'ast_01J00000000000000000000001',
      'art_version',
      'artv_01J00000000000000000000000',
      'style_reference',
      1,
      1,
      0,
      1
    )
    expect(() =>
      insert.run(
        'lnk_01J00000000000000000000003',
        'ast_01J00000000000000000000000',
        'art_version',
        'artv_01J00000000000000000000000',
        'other',
        1,
        2,
        0,
        1
      )
    ).toThrow(/UNIQUE/i)
    expect(() =>
      insert.run(
        'lnk_01J00000000000000000000004',
        'ast_01J00000000000000000000000',
        'art_version',
        'artv_01J00000000000000000000000',
        'other',
        1,
        1,
        0,
        1
      )
    ).toThrow(/UNIQUE/i)
    expect(() =>
      database
        .prepare('update asset_links set weight = 0.5 where id = ?')
        .run('lnk_01J00000000000000000000000')
    ).toThrow(/ART_VERSION_IMMUTABLE/i)
    expect(() =>
      database.prepare('delete from asset_links where id = ?').run('lnk_01J00000000000000000000000')
    ).toThrow(/ART_VERSION_IMMUTABLE/i)
  })

  it('enforces prompt draft hashes, same-project refs, and version numbers', () => {
    const database = fresh()
    database
      .prepare('insert into characters (id,title,created_at,updated_at,row_version) values (?,?,?,?,1)')
      .run('chr_01J00000000000000000000000', 'A', 1, 1)
    for (const projectId of ['artp_01J00000000000000000000000', 'artp_01J00000000000000000000001']) {
      database
        .prepare(
          'insert into art_projects (id,character_id,title,stage,created_at,updated_at,row_version) values (?,?,?,?,?,?,1)'
        )
        .run(projectId, 'chr_01J00000000000000000000000', projectId, 'idea_draft', 1, 1)
    }
    const draft = database.prepare(
      'insert into prompt_drafts (id,art_project_id,revision,status,state_json,content_hash,created_at,updated_at,row_version) values (?,?,?,?,?,?,?,?,1)'
    )
    draft.run(
      'pd_01J00000000000000000000000',
      'artp_01J00000000000000000000000',
      1,
      'active',
      '{}',
      'a'.repeat(64),
      1,
      1
    )
    draft.run(
      'pd_01J00000000000000000000001',
      'artp_01J00000000000000000000001',
      1,
      'active',
      '{}',
      'b'.repeat(64),
      1,
      1
    )
    expect(() =>
      database
        .prepare(
          'insert into prompt_drafts (id,art_project_id,revision,status,state_json,content_hash,created_at,updated_at,row_version) values (?,?,?,?,?,?,?,?,1)'
        )
        .run('pd_bad', 'artp_01J00000000000000000000000', 2, 'committed', '{}', '', 1, 1)
    ).toThrow()

    database
      .prepare(
        'insert into prompt_input_submissions (id,art_project_id,draft_id,revision,requirements_json,created_at,row_version) values (?,?,?,?,?,?,1)'
      )
      .run(
        'pin_01J00000000000000000000000',
        'artp_01J00000000000000000000000',
        'pd_01J00000000000000000000000',
        1,
        '[]',
        1
      )
    database
      .prepare(
        'insert into prompt_input_submissions (id,art_project_id,draft_id,revision,requirements_json,created_at,row_version) values (?,?,?,?,?,?,1)'
      )
      .run(
        'pin_01J00000000000000000000001',
        'artp_01J00000000000000000000001',
        'pd_01J00000000000000000000001',
        1,
        '[]',
        1
      )

    expect(() =>
      database
        .prepare('update prompt_drafts set input_submission_id = ? where id = ?')
        .run('pin_01J00000000000000000000001', 'pd_01J00000000000000000000000')
    ).toThrow(/PROMPT_DRAFT_INPUT_INVALID/)

    const version = database.prepare(
      'insert into prompt_versions (id,art_project_id,input_submission_id,content_json,content_hash,version_number,created_at) values (?,?,?,?,?,?,?)'
    )
    version.run(
      'pv_01J00000000000000000000000',
      'artp_01J00000000000000000000001',
      'pin_01J00000000000000000000001',
      '{}',
      'b'.repeat(64),
      1,
      1
    )
    expect(() =>
      database
        .prepare('update prompt_drafts set base_version_id = ? where id = ?')
        .run('pv_01J00000000000000000000000', 'pd_01J00000000000000000000000')
    ).toThrow(/PROMPT_DRAFT_BASE_INVALID/)
    expect(() =>
      version.run(
        'pv_01J00000000000000000000001',
        'artp_01J00000000000000000000001',
        'pin_01J00000000000000000000001',
        '{}',
        'c'.repeat(64),
        1,
        1
      )
    ).toThrow(/UNIQUE/i)
  })

  it('enforces same-character forks with a trigger', () => {
    const database = fresh()
    database
      .prepare('insert into characters (id,title,created_at,updated_at,row_version) values (?,?,?,?,1)')
      .run('chr_01J00000000000000000000000', 'A', 1, 1)
    database
      .prepare('insert into characters (id,title,created_at,updated_at,row_version) values (?,?,?,?,1)')
      .run('chr_01J00000000000000000000001', 'B', 1, 1)
    for (const [projectId, characterId] of [
      ['artp_01J00000000000000000000000', 'chr_01J00000000000000000000000'],
      ['artp_01J00000000000000000000001', 'chr_01J00000000000000000000001']
    ]) {
      database
        .prepare(
          'insert into art_projects (id,character_id,title,stage,created_at,updated_at,row_version) values (?,?,?,?,?,?,1)'
        )
        .run(projectId, characterId, projectId, 'idea_draft', 1, 1)
    }
    expect(() =>
      database
        .prepare(
          'insert into project_forks (id,child_project_id,parent_project_id,root_project_id,source_kind,source_version_id,source_hash,branch_label,status,created_at) values (?,?,?,?,?,?,?,?,?,?)'
        )
        .run(
          'frk_01J00000000000000000000000',
          'artp_01J00000000000000000000001',
          'artp_01J00000000000000000000000',
          'artp_01J00000000000000000000000',
          'prompt_version',
          'pv_x',
          'a'.repeat(64),
          'x',
          'active',
          1
        )
    ).toThrow(/CHARACTER/i)
  })
})

describe('backups migration', () => {
  it('creates the backup artifact table', () => {
    const database = fresh()
    const columns = database.prepare('pragma table_info(backups)').all() as Array<{
      name: string
      notnull: number
    }>
    expect(columns.map((column) => column.name)).toEqual([
      'id',
      'character_id',
      'job_id',
      'format_version',
      'relative_path',
      'file_size',
      'sha256',
      'created_at',
      'completed_at'
    ])
    expect(() =>
      database
        .prepare(
          `insert into backups (id, character_id, job_id, format_version, relative_path, file_size, sha256, created_at, completed_at)
       values ('bkp_x', 'chr_x', 'job_x', 1, 'backups/x.zip', 10, '${'a'.repeat(64)}', 1, 2)`
        )
        .run()
    ).toThrow()
  })
})

describe('prompt reverse migration', () => {
  it('enforces reverse result foreign keys and applied timestamp consistency', () => {
    const fixture = createTestDatabase()
    try {
      const now = fixture.clock.now()
      fixture.db
        .prepare(
          `insert into jobs (id, type, status, payload_json, payload_hash, created_at, updated_at, side_effect)
           values ('job_rev_1', 'prompt.reverse', 'succeeded', '{}', ?, ?, ?, 'idempotent')`
        )
        .run('a'.repeat(64), now, now)
      expect(() =>
        fixture.db
          .prepare(
            `insert into prompt_reverse_results
             (id, job_id, art_project_id, input_submission_id, base_draft_id, base_draft_revision, base_draft_row_version,
              base_content_hash, state_json, content_hash, status, provider_invocation_id, created_at)
             values ('prv_01J00000000000000000000000', 'job_rev_1', 'missing', 'missing', 'missing', 1, 1, ?, '{}', ?, 'ready', 'missing', ?)`
          )
          .run('a'.repeat(64), 'b'.repeat(64), now)
      ).toThrow()
    } finally {
      fixture.db.close()
    }
  })
})

describe('prompt suggestions migration', () => {
  it('rejects suggestion rows with mismatched base or resolution fields', () => {
    const database = fresh()
    const now = Date.now()
    const insert = database.prepare(
      `insert into prompt_suggestions
       (id, job_id, base_kind, base_version_id, base_draft_id, base_draft_revision, base_draft_row_version,
        base_content_hash, operations_json, intent, status, provider_invocation_id, created_at)
       values (?, 'missing-job', 'prompt_version', 'missing-version', ?, ?, ?, ?, '[]', 'test', 'proposed', 'missing', ?)`
    )
    expect(() => insert.run('psg_1', null, null, null, 'a'.repeat(64), now)).toThrow()
    expect(() => insert.run('psg_2', 'missing-draft', 1, 1, 'a'.repeat(64), now)).toThrow()
  })
})
