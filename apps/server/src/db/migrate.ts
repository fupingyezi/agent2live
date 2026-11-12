import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

interface Row {
  version: string
  checksum: string
}

export function migrate(db: Database.Database, dir: string): { applied: string[] } {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `)
  const appliedRows = new Map(
    (db.prepare('select version, checksum from schema_migrations').all() as Row[]).map((row) => [
      row.version,
      row.checksum
    ])
  )
  const files = readdirSync(dir)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
  const applied: string[] = []
  const run = db.transaction(() => {
    for (const name of files) {
      const version = name.replace(/\.sql$/, '')
      const sql = readFileSync(join(dir, name), 'utf8')
      const checksum = createHash('sha256').update(sql).digest('hex')
      const previous = appliedRows.get(version)
      if (previous) {
        if (previous !== checksum) throw new Error(`migration checksum mismatch: ${version}`)
        continue
      }
      db.exec(sql)
      db.prepare('insert into schema_migrations (version, checksum, applied_at) values (?, ?, ?)').run(
        version,
        checksum,
        Date.now()
      )
      applied.push(version)
    }
  })
  run()
  return { applied }
}

export function latestMigrationVersion(db: Database.Database): string | null {
  const table = db
    .prepare("select name from sqlite_master where type = 'table' and name = 'schema_migrations'")
    .get() as { name: string } | undefined
  if (!table) return null
  const row = db.prepare('select version from schema_migrations order by version desc limit 1').get() as
    | { version: string }
    | undefined
  return row?.version ?? null
}
