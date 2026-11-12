import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'

export function openDatabase(file: string): Database.Database {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.pragma('synchronous = NORMAL')
  db.pragma('temp_store = MEMORY')
  sqliteVec.load(db)
  return db
}
