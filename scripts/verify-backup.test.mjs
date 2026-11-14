import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'
import { BACKUP_COUNT_TYPES, crc32, sha256Hex, verifyBackupBytes } from './verify-backup.mjs'

const CHARACTER_ID = 'chr_01J00000000000000000000000'
const BACKUP_ID = 'bkp_01J00000000000000000000000'
const ASSET_ID = 'ast_01J00000000000000000000000'
const SCHEMA_VERSION = '0004_backups'
const BLOB = Buffer.from('deterministic backup blob\n', 'utf8')
const BLOB_SHA = sha256Hex(BLOB)
const SCRIPT_PATH = fileURLToPath(new URL('./verify-backup.mjs', import.meta.url))
const EXCLUDED = [
  'provider_connections',
  'provider_invocations',
  'jobs',
  'job_events',
  'secrets',
  'model_artifacts'
]

function baseFixture() {
  const counts = Object.fromEntries(BACKUP_COUNT_TYPES.map((type) => [type, 0]))
  counts.character = 1
  counts.asset = 1
  const manifest = {
    format: 'agent2live.character-export',
    formatVersion: 1,
    appVersion: '0.0.0-test',
    schemaVersion: SCHEMA_VERSION,
    characterId: CHARACTER_ID,
    backupId: BACKUP_ID,
    createdAt: 1,
    restoreSupported: false,
    modelsIncluded: false,
    entityCount: 2,
    blobCount: 1,
    blobBytes: BLOB.length,
    counts,
    blobs: [{ sha256: BLOB_SHA, byteSize: BLOB.length, mediaType: 'image/png' }],
    licenses: {
      application: 'GPL-3.0-only',
      cubismCore: 'not included',
      psd2live: 'not included'
    },
    excluded: EXCLUDED
  }
  const schema = {
    formatVersion: 1,
    schemaVersion: SCHEMA_VERSION,
    migrations: [{ version: SCHEMA_VERSION, checksum: 'b'.repeat(64), appliedAt: 1 }]
  }
  const entities = [
    { type: 'character', data: { id: CHARACTER_ID, title: 'fixture' } },
    {
      type: 'asset',
      data: {
        id: ASSET_ID,
        sha256: BLOB_SHA,
        media_type: 'image/png',
        byte_size: BLOB.length,
        width: null,
        height: null,
        created_at: 1
      }
    }
  ]
  return {
    manifest,
    schema,
    entities,
    files: {
      'manifest.json': Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
      'schema/versions.json': Buffer.from(`${JSON.stringify(schema, null, 2)}\n`),
      'database/entities.jsonl': Buffer.from(
        `${entities.map((entity) => JSON.stringify(entity)).join('\n')}\n`
      ),
      [`blobs/${BLOB_SHA}`]: BLOB
    }
  }
}

function finalizeFixture(files) {
  const names = Object.keys(files)
    .filter((name) => name !== 'checksums.sha256')
    .sort()
  files['checksums.sha256'] = Buffer.from(
    names.map((name) => `${sha256Hex(files[name])}  ${name}\n`).join('')
  )
  return files
}

function makeFixture(mutate) {
  const fixture = baseFixture()
  mutate?.(fixture.files, fixture)
  return finalizeFixture(fixture.files)
}

function buildZip(input, options = {}) {
  const entries = Array.isArray(input)
    ? input.map(([name, data]) => ({ name, data: Buffer.from(data) }))
    : Object.entries(input).map(([name, data]) => ({ name, data: Buffer.from(data) }))
  const flagsFor = options.flagsFor ?? {}
  const zip64For = options.zip64For ?? new Set()
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const compressed = deflateRawSync(entry.data)
    const crc = crc32(entry.data)
    const flags = flagsFor[entry.name] ?? 0
    const extra = zip64For.has(entry.name) ? Buffer.from([0x01, 0x00, 0x00, 0x00]) : Buffer.alloc(0)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(extra.length, 28)
    localParts.push(local, nameBytes, extra, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x031e, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(extra.length, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE((0o100600 << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBytes, extra)

    offset += local.length + nameBytes.length + extra.length + compressed.length
  }

  const centralOffset = offset
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(centralOffset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, ...centralParts, eocd])
}

function errorCodes(report) {
  return new Set(report.errors.map((error) => error.code))
}

test('accepts a structurally valid character export', () => {
  const report = verifyBackupBytes(buildZip(makeFixture()), {
    sourcePath: 'fixture.zip',
    now: new Date(0)
  })
  assert.equal(report.status, 'pass')
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.checks, {
    zipStructure: true,
    entrySetExact: true,
    checksumsValid: true,
    manifestValid: true,
    schemaValid: true,
    entitiesValid: true,
    blobFilesValid: true,
    textSafe: true
  })
  assert.equal(report.artifact.path, 'fixture.zip')
  assert.equal(report.artifact.byteSize, buildZip(makeFixture()).length)
  assert.equal(report.manifest.characterId, CHARACTER_ID)
  assert.equal(report.manifest.backupId, BACKUP_ID)
})

test('rejects a checksum mismatch', () => {
  const files = makeFixture()
  const text = files['checksums.sha256'].toString('utf8').trimEnd().split('\n')
  text[0] = `${'0'.repeat(64)}  ${text[0].slice(66)}`
  files['checksums.sha256'] = Buffer.from(`${text.join('\n')}\n`)
  const report = verifyBackupBytes(buildZip(files), { sourcePath: 'fixture.zip' })
  assert.equal(report.status, 'fail')
  assert.equal(errorCodes(report).has('CHECKSUM_MISMATCH'), true)
})

test('rejects missing and unexpected entries', () => {
  const files = makeFixture()
  delete files[`blobs/${BLOB_SHA}`]
  files['notes.txt'] = Buffer.from('not part of the export\n')
  const report = verifyBackupBytes(buildZip(files), { sourcePath: 'fixture.zip' })
  assert.equal(report.status, 'fail')
  const codes = errorCodes(report)
  assert.equal(codes.has('ZIP_MISSING_ENTRY'), true)
  assert.equal(codes.has('ZIP_UNEXPECTED_ENTRY'), true)
  assert.equal(codes.has('CHECKSUM_MISSING_ENTRY'), true)
  assert.equal(report.checks.entrySetExact, false)
})

test('rejects unsafe entry names', () => {
  const files = makeFixture()
  files['../escape.txt'] = Buffer.from('escape\n')
  const report = verifyBackupBytes(buildZip(files), { sourcePath: 'fixture.zip' })
  assert.equal(report.status, 'fail')
  assert.equal(errorCodes(report).has('ZIP_PATH_UNSAFE'), true)
})

test('rejects encrypted entries', () => {
  const report = verifyBackupBytes(buildZip(makeFixture(), { flagsFor: { 'manifest.json': 1 } }), {
    sourcePath: 'fixture.zip'
  })
  assert.equal(report.status, 'fail')
  assert.equal(errorCodes(report).has('ZIP_ENCRYPTED'), true)
})

test('rejects ZIP64 extra fields', () => {
  const report = verifyBackupBytes(buildZip(makeFixture(), { zip64For: new Set(['manifest.json']) }), {
    sourcePath: 'fixture.zip'
  })
  assert.equal(report.status, 'fail')
  assert.equal(errorCodes(report).has('ZIP64_UNSUPPORTED'), true)
})

test('rejects duplicate entries', () => {
  const files = makeFixture()
  const report = verifyBackupBytes(
    buildZip([...Object.entries(files), ['manifest.json', files['manifest.json']]]),
    { sourcePath: 'fixture.zip' }
  )
  assert.equal(report.status, 'fail')
  assert.equal(errorCodes(report).has('ZIP_DUPLICATE_ENTRY'), true)
})

test('rejects manifest counts that do not match entities', () => {
  const files = makeFixture((target, fixture) => {
    fixture.manifest.counts.character = 2
    fixture.manifest.entityCount = 3
    target['manifest.json'] = Buffer.from(`${JSON.stringify(fixture.manifest, null, 2)}\n`)
  })
  const report = verifyBackupBytes(buildZip(files), { sourcePath: 'fixture.zip' })
  assert.equal(report.status, 'fail')
  assert.equal(errorCodes(report).has('ENTITY_COUNT_MISMATCH'), true)
  assert.equal(errorCodes(report).has('COUNTS_MISMATCH'), true)
})

test('rejects asset storage keys', () => {
  const files = makeFixture((target, fixture) => {
    fixture.entities[1].data.storage_key = 'local/absolute/path'
    target['database/entities.jsonl'] = Buffer.from(
      `${fixture.entities.map((entity) => JSON.stringify(entity)).join('\n')}\n`
    )
  })
  const report = verifyBackupBytes(buildZip(files), { sourcePath: 'fixture.zip' })
  assert.equal(report.status, 'fail')
  assert.equal(errorCodes(report).has('ENTITY_ASSET_INVALID'), true)
})

test('rejects absolute local paths and secret markers in text entries', () => {
  const files = makeFixture((target, fixture) => {
    fixture.entities[0].data.note = '/Users/example/private'
    fixture.entities[0].data.leak = 'secret_ref=sk-should-never-appear'
    target['database/entities.jsonl'] = Buffer.from(
      `${fixture.entities.map((entity) => JSON.stringify(entity)).join('\n')}\n`
    )
  })
  const report = verifyBackupBytes(buildZip(files), { sourcePath: 'fixture.zip' })
  assert.equal(report.status, 'fail')
  assert.equal(errorCodes(report).has('SENSITIVE_DATA_LEAK'), true)
})

test('CLI writes a report and uses 0/1/2 exit codes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent2live-verify-'))
  try {
    const validZip = join(dir, 'valid.zip')
    const validReport = join(dir, 'valid.json')
    writeFileSync(validZip, buildZip(makeFixture()))
    const valid = spawnSync(process.execPath, [SCRIPT_PATH, validZip, '--json', validReport], {
      encoding: 'utf8'
    })
    assert.equal(valid.status, 0, valid.stderr)
    const parsed = JSON.parse(readFileSync(validReport, 'utf8'))
    assert.equal(parsed.status, 'pass')
    assert.equal(parsed.artifact.path, 'valid.zip')
    assert.equal(parsed.artifact.path.includes(dir), false)

    const files = makeFixture()
    const checksumText = files['checksums.sha256'].toString('utf8').trimEnd().split('\n')
    checksumText[0] = `${'f'.repeat(64)}  ${checksumText[0].slice(66)}`
    files['checksums.sha256'] = Buffer.from(`${checksumText.join('\n')}\n`)
    const invalidZip = join(dir, 'invalid.zip')
    const invalidReport = join(dir, 'invalid.json')
    writeFileSync(invalidZip, buildZip(files))
    const invalid = spawnSync(process.execPath, [SCRIPT_PATH, invalidZip, '--json', invalidReport], {
      encoding: 'utf8'
    })
    assert.equal(invalid.status, 1)
    assert.equal(JSON.parse(readFileSync(invalidReport, 'utf8')).status, 'fail')

    const usage = spawnSync(process.execPath, [SCRIPT_PATH], { encoding: 'utf8' })
    assert.equal(usage.status, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
