#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

export const REPORT_SCHEMA_VERSION = 'backup-verification/1'
export const BACKUP_COUNT_TYPES = Object.freeze([
  'character',
  'character_brief_version',
  'art_project',
  'project_fork',
  'prompt_input_submission',
  'prompt_draft',
  'prompt_version',
  'prompt_reverse_result',
  'prompt_suggestion',
  'generation_job',
  'generation_candidate',
  'art_version',
  'asset_link',
  'asset_provenance',
  'asset',
  'audit_event'
])

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const MAX_EOCD_SEARCH = 0xffff + 22
const MAX_ENTRIES = 10_000
const MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024
const FIXED_ENTRIES = Object.freeze([
  'manifest.json',
  'schema/versions.json',
  'database/entities.jsonl',
  'checksums.sha256'
])
const MANIFEST_KEYS = Object.freeze([
  'format',
  'formatVersion',
  'appVersion',
  'schemaVersion',
  'characterId',
  'backupId',
  'createdAt',
  'restoreSupported',
  'modelsIncluded',
  'entityCount',
  'blobCount',
  'blobBytes',
  'counts',
  'blobs',
  'licenses',
  'excluded'
])
const EXCLUDED_ENTITIES = Object.freeze([
  'provider_connections',
  'provider_invocations',
  'jobs',
  'job_events',
  'secrets',
  'model_artifacts'
])
const ENTITY_RANK = new Map(BACKUP_COUNT_TYPES.map((type, index) => [type, index]))
const BACKUP_ID_PATTERN = /^bkp_[0-9A-HJKMNP-TV-Z]{26}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const BLOB_ENTRY_PATTERN = /^blobs\/[0-9a-f]{64}$/
const LEAK_PATTERNS = Object.freeze([
  { code: 'ABSOLUTE_USER_PATH', pattern: /\/Users\// },
  { code: 'SECRET_REFERENCE', pattern: /secret_ref/i },
  { code: 'PROVIDER_KEY', pattern: /\b(?:sk-|ark-)[A-Za-z0-9_-]{8,}/ },
  { code: 'BEARER_TOKEN', pattern: /Bearer\s+[A-Za-z0-9._-]{12,}/ }
])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

export function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function isNonEmptyString(value, maxLength = 500) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function decodeUtf8(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error('UTF-8 BOM is not allowed')
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

class ZipParseError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ZipParseError'
    this.code = code
  }
}

function readExtraFields(bytes, contextCode) {
  let offset = 0
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) {
      throw new ZipParseError(contextCode, 'truncated ZIP extra field')
    }
    const id = bytes.readUInt16LE(offset)
    const size = bytes.readUInt16LE(offset + 2)
    if (offset + 4 + size > bytes.length) {
      throw new ZipParseError(contextCode, 'ZIP extra field length exceeds its buffer')
    }
    if (id === 0x0001) {
      throw new ZipParseError('ZIP64_UNSUPPORTED', 'ZIP64 extra fields are not supported')
    }
    offset += 4 + size
  }
}

function hasControlCharacter(value) {
  for (const character of value) {
    const code = character.codePointAt(0)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

function validateEntryName(name) {
  if (!name || name.length > 300) {
    throw new ZipParseError('ZIP_PATH_UNSAFE', 'ZIP entry name is empty or too long')
  }
  if (name.startsWith('/') || name.includes('\\') || name.includes('\0') || hasControlCharacter(name)) {
    throw new ZipParseError('ZIP_PATH_UNSAFE', 'ZIP entry name contains an unsafe character')
  }
  const segments = name.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new ZipParseError('ZIP_PATH_UNSAFE', 'ZIP entry name contains an unsafe path segment')
  }
  if (name.endsWith('/')) {
    throw new ZipParseError('ZIP_DIRECTORY_ENTRY', 'ZIP directory entries are not allowed')
  }
}

function parseZip(sourceBytes) {
  const bytes = Buffer.isBuffer(sourceBytes) ? sourceBytes : Buffer.from(sourceBytes)
  if (bytes.length < 22) {
    throw new ZipParseError('ZIP_EOCD_NOT_FOUND', 'ZIP is shorter than an end-of-central-directory record')
  }

  let eocdOffset = -1
  const minimumOffset = Math.max(0, bytes.length - MAX_EOCD_SEARCH)
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (
      bytes.readUInt32LE(offset) === EOCD_SIGNATURE &&
      offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length
    ) {
      eocdOffset = offset
      break
    }
  }
  if (eocdOffset < 0) {
    throw new ZipParseError('ZIP_EOCD_NOT_FOUND', 'ZIP end-of-central-directory record not found')
  }

  const diskNumber = bytes.readUInt16LE(eocdOffset + 4)
  const centralDisk = bytes.readUInt16LE(eocdOffset + 6)
  const entriesOnDisk = bytes.readUInt16LE(eocdOffset + 8)
  const totalEntries = bytes.readUInt16LE(eocdOffset + 10)
  const centralSize = bytes.readUInt32LE(eocdOffset + 12)
  const centralOffset = bytes.readUInt32LE(eocdOffset + 16)
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) {
    throw new ZipParseError('ZIP_MULTI_DISK', 'multi-disk ZIP archives are not supported')
  }
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new ZipParseError('ZIP64_UNSUPPORTED', 'ZIP64 archives are not supported')
  }
  if (totalEntries > MAX_ENTRIES) {
    throw new ZipParseError('ZIP_CENTRAL_DIRECTORY_INVALID', 'ZIP contains too many entries')
  }
  if (centralOffset + centralSize > eocdOffset) {
    throw new ZipParseError('ZIP_CENTRAL_DIRECTORY_INVALID', 'central directory overlaps the EOCD record')
  }

  const centralEnd = centralOffset + centralSize
  const entries = []
  const names = new Set()
  let cursor = centralOffset
  let totalUncompressed = 0

  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > centralEnd) {
      throw new ZipParseError('ZIP_CENTRAL_DIRECTORY_INVALID', 'truncated central directory entry')
    }
    if (bytes.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new ZipParseError('ZIP_CENTRAL_DIRECTORY_INVALID', 'invalid central directory signature')
    }
    const flags = bytes.readUInt16LE(cursor + 8)
    const compression = bytes.readUInt16LE(cursor + 10)
    const checksum = bytes.readUInt32LE(cursor + 16)
    const compressedSize = bytes.readUInt32LE(cursor + 20)
    const uncompressedSize = bytes.readUInt32LE(cursor + 24)
    const nameLength = bytes.readUInt16LE(cursor + 28)
    const extraLength = bytes.readUInt16LE(cursor + 30)
    const commentLength = bytes.readUInt16LE(cursor + 32)
    const diskStart = bytes.readUInt16LE(cursor + 34)
    const externalAttributes = bytes.readUInt32LE(cursor + 38)
    const localOffset = bytes.readUInt32LE(cursor + 42)
    const entryEnd = cursor + 46 + nameLength + extraLength + commentLength
    if (entryEnd > centralEnd) {
      throw new ZipParseError('ZIP_CENTRAL_DIRECTORY_INVALID', 'central directory entry exceeds its region')
    }
    if (diskStart !== 0) {
      throw new ZipParseError('ZIP_MULTI_DISK', 'entry references a different disk')
    }
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0) {
      throw new ZipParseError('ZIP_ENCRYPTED', 'encrypted ZIP entries are not allowed')
    }
    if (compression !== 0 && compression !== 8) {
      throw new ZipParseError('ZIP_UNSUPPORTED_COMPRESSION', 'only stored and deflated entries are supported')
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new ZipParseError('ZIP64_UNSUPPORTED', 'ZIP64 entry fields are not supported')
    }

    let name
    try {
      name = decodeUtf8(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
    } catch {
      throw new ZipParseError('ZIP_ENTRY_NAME_INVALID', 'ZIP entry name is not valid UTF-8')
    }
    validateEntryName(name)
    if (names.has(name)) {
      throw new ZipParseError('ZIP_DUPLICATE_ENTRY', 'ZIP contains duplicate entry names')
    }
    names.add(name)
    readExtraFields(
      bytes.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength),
      'ZIP_CENTRAL_DIRECTORY_INVALID'
    )

    const fileType = (externalAttributes >>> 16) & 0o170000
    if (fileType === 0o040000) {
      throw new ZipParseError('ZIP_DIRECTORY_ENTRY', 'ZIP directory entries are not allowed')
    }
    if (fileType !== 0 && fileType !== 0o100000) {
      throw new ZipParseError('ZIP_UNSAFE_ENTRY', 'ZIP contains a non-regular file entry')
    }

    if (localOffset + 30 > centralOffset || bytes.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new ZipParseError('ZIP_LOCAL_HEADER_INVALID', 'invalid local file header offset')
    }
    const localFlags = bytes.readUInt16LE(localOffset + 6)
    const localCompression = bytes.readUInt16LE(localOffset + 8)
    const localNameLength = bytes.readUInt16LE(localOffset + 26)
    const localExtraLength = bytes.readUInt16LE(localOffset + 28)
    if ((localFlags & 0x0001) !== 0 || (localFlags & 0x0040) !== 0) {
      throw new ZipParseError('ZIP_ENCRYPTED', 'encrypted local ZIP headers are not allowed')
    }
    if (localCompression !== compression) {
      throw new ZipParseError('ZIP_LOCAL_HEADER_INVALID', 'local and central compression methods differ')
    }
    let localName
    try {
      localName = decodeUtf8(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength))
    } catch {
      throw new ZipParseError('ZIP_ENTRY_NAME_INVALID', 'local ZIP entry name is not valid UTF-8')
    }
    if (localName !== name) {
      throw new ZipParseError('ZIP_LOCAL_HEADER_INVALID', 'local and central entry names differ')
    }
    readExtraFields(
      bytes.subarray(
        localOffset + 30 + localNameLength,
        localOffset + 30 + localNameLength + localExtraLength
      ),
      'ZIP_LOCAL_HEADER_INVALID'
    )
    if ((flags & 0x0008) === 0) {
      if (
        bytes.readUInt32LE(localOffset + 14) !== checksum ||
        bytes.readUInt32LE(localOffset + 18) !== compressedSize ||
        bytes.readUInt32LE(localOffset + 22) !== uncompressedSize
      ) {
        throw new ZipParseError(
          'ZIP_LOCAL_HEADER_INVALID',
          'local header sizes or CRC differ from central directory'
        )
      }
    }

    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > centralOffset) {
      throw new ZipParseError('ZIP_LOCAL_HEADER_INVALID', 'entry data overlaps the central directory')
    }
    if (totalUncompressed + uncompressedSize > MAX_UNCOMPRESSED_BYTES) {
      throw new ZipParseError('ZIP_TOO_LARGE', 'ZIP uncompressed size exceeds the backup limit')
    }
    const compressed = bytes.subarray(dataStart, dataEnd)
    let data
    try {
      data =
        compression === 0
          ? Buffer.from(compressed)
          : inflateRawSync(compressed, { maxOutputLength: uncompressedSize + 1 })
    } catch {
      throw new ZipParseError('ZIP_DEFLATE_INVALID', 'ZIP entry could not be inflated')
    }
    if (data.length !== uncompressedSize) {
      throw new ZipParseError('ZIP_SIZE_MISMATCH', 'ZIP entry uncompressed size does not match')
    }
    if (crc32(data) !== checksum) {
      throw new ZipParseError('ZIP_CRC_MISMATCH', 'ZIP entry CRC does not match')
    }
    totalUncompressed += data.length

    entries.push({ name, data, localOffset, dataEnd })
    cursor = entryEnd
  }

  if (cursor !== centralEnd) {
    throw new ZipParseError(
      'ZIP_CENTRAL_DIRECTORY_INVALID',
      'central directory size does not match its entries'
    )
  }

  const orderedByOffset = [...entries].sort((left, right) => left.localOffset - right.localOffset)
  for (let index = 1; index < orderedByOffset.length; index += 1) {
    if (orderedByOffset[index].localOffset < orderedByOffset[index - 1].dataEnd) {
      throw new ZipParseError('ZIP_ENTRY_OVERLAP', 'ZIP entries overlap')
    }
  }

  return {
    entries,
    map: new Map(entries.map((entry) => [entry.name, entry]))
  }
}

function expectExactKeys(value, expected, code, label, addError) {
  const actualKeys = Object.keys(value).sort()
  const expectedKeys = [...expected].sort()
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    addError(code, `${label} keys do not match schemaVersion 1`)
    return false
  }
  return true
}

function validateManifest(value, addError) {
  if (!isPlainObject(value)) {
    addError('MANIFEST_INVALID', 'manifest.json must contain a JSON object')
    return null
  }
  expectExactKeys(value, MANIFEST_KEYS, 'MANIFEST_INVALID', 'manifest', addError)
  if (value.format !== 'agent2live.character-export') {
    addError('MANIFEST_INVALID', 'manifest format is not agent2live.character-export')
  }
  if (value.formatVersion !== 1) {
    addError('MANIFEST_INVALID', 'manifest formatVersion must be 1')
  }
  if (!isNonEmptyString(value.appVersion, 128)) {
    addError('MANIFEST_INVALID', 'manifest appVersion must be a non-empty string')
  }
  if (!(value.schemaVersion === null || isNonEmptyString(value.schemaVersion, 128))) {
    addError('MANIFEST_INVALID', 'manifest schemaVersion must be a string or null')
  }
  if (!isNonEmptyString(value.characterId, 64)) {
    addError('MANIFEST_INVALID', 'manifest characterId must be a non-empty string')
  }
  if (typeof value.backupId !== 'string' || !BACKUP_ID_PATTERN.test(value.backupId)) {
    addError('MANIFEST_INVALID', 'manifest backupId is not a backup ID')
  }
  if (!isSafeInteger(value.createdAt)) {
    addError('MANIFEST_INVALID', 'manifest createdAt must be a non-negative integer')
  }
  if (value.restoreSupported !== false) {
    addError('MANIFEST_INVALID', 'manifest restoreSupported must be false')
  }
  if (value.modelsIncluded !== false) {
    addError('MANIFEST_INVALID', 'manifest modelsIncluded must be false')
  }

  let countSum = null
  if (!isPlainObject(value.counts)) {
    addError('MANIFEST_INVALID', 'manifest counts must be an object')
  } else {
    expectExactKeys(value.counts, BACKUP_COUNT_TYPES, 'MANIFEST_INVALID', 'manifest counts', addError)
    let valid = true
    let sum = 0
    for (const type of BACKUP_COUNT_TYPES) {
      const count = value.counts[type]
      if (!isSafeInteger(count)) {
        addError('MANIFEST_INVALID', 'manifest counts must contain non-negative integers')
        valid = false
        break
      }
      sum += count
    }
    if (valid) countSum = sum
  }

  const blobs = []
  if (!Array.isArray(value.blobs)) {
    addError('MANIFEST_INVALID', 'manifest blobs must be an array')
  } else {
    let previousSha = ''
    for (const item of value.blobs) {
      if (!isPlainObject(item)) {
        addError('MANIFEST_INVALID', 'manifest blob entries must be objects')
        continue
      }
      expectExactKeys(
        item,
        ['sha256', 'byteSize', 'mediaType'],
        'MANIFEST_INVALID',
        'manifest blob',
        addError
      )
      if (typeof item.sha256 !== 'string' || !SHA256_PATTERN.test(item.sha256)) {
        addError('MANIFEST_INVALID', 'manifest blob sha256 must be lowercase SHA-256')
        continue
      }
      if (item.sha256 <= previousSha) {
        addError('MANIFEST_INVALID', 'manifest blobs must be unique and sorted by sha256')
      }
      previousSha = item.sha256
      if (!Number.isSafeInteger(item.byteSize) || item.byteSize <= 0) {
        addError('MANIFEST_INVALID', 'manifest blob byteSize must be a positive integer')
        continue
      }
      if (!isNonEmptyString(item.mediaType, 200)) {
        addError('MANIFEST_INVALID', 'manifest blob mediaType must be a non-empty string')
        continue
      }
      blobs.push({ sha256: item.sha256, byteSize: item.byteSize, mediaType: item.mediaType })
    }
    if (value.blobCount !== value.blobs.length) {
      addError('MANIFEST_INCONSISTENT', 'manifest blobCount does not match its blobs array')
    }
    const blobBytes = blobs.reduce((sum, blob) => sum + blob.byteSize, 0)
    if (value.blobBytes !== blobBytes) {
      addError('MANIFEST_INCONSISTENT', 'manifest blobBytes does not match its blobs array')
    }
  }

  if (!isSafeInteger(value.entityCount)) {
    addError('MANIFEST_INVALID', 'manifest entityCount must be a non-negative integer')
  } else if (countSum !== null && value.entityCount !== countSum) {
    addError('MANIFEST_INCONSISTENT', 'manifest entityCount does not equal the sum of counts')
  }
  if (!isSafeInteger(value.blobCount)) {
    addError('MANIFEST_INVALID', 'manifest blobCount must be a non-negative integer')
  }
  if (!isSafeInteger(value.blobBytes)) {
    addError('MANIFEST_INVALID', 'manifest blobBytes must be a non-negative integer')
  }

  if (!isPlainObject(value.licenses)) {
    addError('MANIFEST_INVALID', 'manifest licenses must be an object')
  } else {
    expectExactKeys(
      value.licenses,
      ['application', 'cubismCore', 'psd2live'],
      'MANIFEST_INVALID',
      'manifest licenses',
      addError
    )
    if (
      value.licenses.application !== 'GPL-3.0-only' ||
      value.licenses.cubismCore !== 'not included' ||
      value.licenses.psd2live !== 'not included'
    ) {
      addError('MANIFEST_INVALID', 'manifest license boundary is invalid')
    }
  }

  if (!Array.isArray(value.excluded)) {
    addError('MANIFEST_INVALID', 'manifest excluded must be an array')
  } else if (
    value.excluded.length !== EXCLUDED_ENTITIES.length ||
    value.excluded.some((entry, index) => entry !== EXCLUDED_ENTITIES[index])
  ) {
    addError('MANIFEST_INVALID', 'manifest excluded entries do not match the format')
  }

  return {
    blobs,
    // validateEntities needs the raw per-type histogram for COUNTS_MISMATCH;
    // the published manifest stays summary-only, without the counts table.
    counts: value.counts,
    summary: {
      formatVersion: value.formatVersion,
      characterId: value.characterId,
      backupId: value.backupId,
      schemaVersion: value.schemaVersion,
      entityCount: value.entityCount,
      blobCount: value.blobCount,
      blobBytes: value.blobBytes
    }
  }
}

function validateSchema(value, manifest, addError) {
  if (!isPlainObject(value)) {
    addError('SCHEMA_INVALID', 'schema/versions.json must contain a JSON object')
    return
  }
  expectExactKeys(
    value,
    ['formatVersion', 'schemaVersion', 'migrations'],
    'SCHEMA_INVALID',
    'schema',
    addError
  )
  if (value.formatVersion !== 1) {
    addError('SCHEMA_INVALID', 'schema formatVersion must be 1')
  }
  if (!(value.schemaVersion === null || isNonEmptyString(value.schemaVersion, 128))) {
    addError('SCHEMA_INVALID', 'schema schemaVersion must be a string or null')
  }
  if (!Array.isArray(value.migrations)) {
    addError('SCHEMA_INVALID', 'schema migrations must be an array')
  } else {
    let previousVersion = null
    for (const migration of value.migrations) {
      if (!isPlainObject(migration)) {
        addError('SCHEMA_INVALID', 'schema migration entries must be objects')
        continue
      }
      expectExactKeys(
        migration,
        ['version', 'checksum', 'appliedAt'],
        'SCHEMA_INVALID',
        'schema migration',
        addError
      )
      if (!isNonEmptyString(migration.version, 200)) {
        addError('SCHEMA_INVALID', 'schema migration version must be a non-empty string')
      }
      if (typeof migration.checksum !== 'string' || !SHA256_PATTERN.test(migration.checksum)) {
        addError('SCHEMA_INVALID', 'schema migration checksum must be lowercase SHA-256')
      }
      if (!isSafeInteger(migration.appliedAt)) {
        addError('SCHEMA_INVALID', 'schema migration appliedAt must be a non-negative integer')
      }
      if (
        typeof migration.version === 'string' &&
        previousVersion !== null &&
        migration.version <= previousVersion
      ) {
        addError('SCHEMA_INVALID', 'schema migrations must be strictly ordered by version')
      }
      if (typeof migration.version === 'string') previousVersion = migration.version
    }
    const lastVersion =
      value.migrations.length > 0 ? (value.migrations[value.migrations.length - 1]?.version ?? null) : null
    if (lastVersion !== value.schemaVersion) {
      addError('SCHEMA_INVALID', 'schemaVersion must equal the last migration version')
    }
  }
  if (manifest && value.schemaVersion !== manifest.summary.schemaVersion) {
    addError('SCHEMA_INVALID', 'schemaVersion does not match manifest')
  }
}

function validateEntities(text, manifest, addError) {
  if (text === null) return
  if (!text.endsWith('\n') || text.includes('\r') || text.trim() === '') {
    addError('ENTITIES_INVALID', 'entities.jsonl must be non-empty LF-terminated JSONL')
    return
  }
  const lines = text.slice(0, -1).split('\n')
  const records = []
  const histogram = new Map()
  let previousRank = -1
  for (const [index, line] of lines.entries()) {
    if (line === '') {
      addError('ENTITIES_INVALID', 'entities.jsonl contains an empty line')
      continue
    }
    let record
    try {
      record = JSON.parse(line)
    } catch {
      addError('ENTITIES_INVALID', `entities.jsonl line ${index + 1} is not valid JSON`)
      continue
    }
    if (!isPlainObject(record)) {
      addError('ENTITIES_INVALID', 'entity records must be JSON objects')
      continue
    }
    expectExactKeys(record, ['type', 'data'], 'ENTITIES_INVALID', 'entity record', addError)
    if (typeof record.type !== 'string' || !ENTITY_RANK.has(record.type)) {
      addError('ENTITY_TYPE_UNKNOWN', 'entity record contains an unknown type')
      continue
    }
    if (!isPlainObject(record.data)) {
      addError('ENTITIES_INVALID', 'entity data must be an object')
      continue
    }
    const rank = ENTITY_RANK.get(record.type)
    if (rank < previousRank) {
      addError('ENTITY_ORDER_INVALID', 'entity records are not ordered by their fixed type rank')
    }
    previousRank = Math.max(previousRank, rank)
    histogram.set(record.type, (histogram.get(record.type) ?? 0) + 1)
    records.push(record)
  }

  if (manifest) {
    if (records.length !== manifest.summary.entityCount) {
      addError('ENTITY_COUNT_MISMATCH', 'entity record count does not match manifest entityCount')
    }
    for (const type of BACKUP_COUNT_TYPES) {
      if ((histogram.get(type) ?? 0) !== manifest.counts[type]) {
        addError('COUNTS_MISMATCH', 'entity type counts do not match manifest counts')
        break
      }
    }

    const characters = records.filter((record) => record.type === 'character')
    if (characters.length !== 1) {
      addError('ENTITY_CHARACTER_INVALID', 'backup must contain exactly one character entity')
    } else if (characters[0].data.id !== manifest.summary.characterId) {
      addError('ENTITY_CHARACTER_INVALID', 'character entity ID does not match manifest')
    }

    for (const project of records.filter((record) => record.type === 'art_project')) {
      if (project.data.character_id !== manifest.summary.characterId) {
        addError('ENTITY_PROJECT_INVALID', 'art project belongs to a different character')
      }
    }

    const blobBySha = new Map(manifest.blobs.map((blob) => [blob.sha256, blob]))
    const assetShas = new Set()
    for (const asset of records.filter((record) => record.type === 'asset')) {
      const data = asset.data
      if (Object.hasOwn(data, 'storage_key')) {
        addError('ENTITY_ASSET_INVALID', 'asset entity must not export storage_key')
        continue
      }
      if (typeof data.sha256 !== 'string' || !SHA256_PATTERN.test(data.sha256)) {
        addError('ENTITY_ASSET_INVALID', 'asset entity sha256 is invalid')
        continue
      }
      const blob = blobBySha.get(data.sha256)
      if (!blob) {
        addError('ENTITY_ASSET_INVALID', 'asset entity is absent from manifest blobs')
        continue
      }
      if (data.byte_size !== blob.byteSize || data.media_type !== blob.mediaType) {
        addError('ENTITY_ASSET_INVALID', 'asset entity metadata differs from manifest blob metadata')
      }
      assetShas.add(data.sha256)
    }
    if (assetShas.size !== blobBySha.size || [...blobBySha.keys()].some((sha) => !assetShas.has(sha))) {
      addError('ENTITY_ASSET_INVALID', 'asset entities do not match manifest blobs')
    }
  }
}

function validateChecksums(text, archive, addError) {
  if (text === null) return
  if (!text.endsWith('\n') || text.includes('\r')) {
    addError('CHECKSUM_FORMAT_INVALID', 'checksums.sha256 must be LF terminated')
  }
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  const lines = body === '' ? [] : body.split('\n')
  if (lines.length === 0) {
    addError('CHECKSUM_FORMAT_INVALID', 'checksums.sha256 must not be empty')
    return
  }
  const seen = new Set()
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  ([^\n]+)$/.exec(line)
    if (!match) {
      addError('CHECKSUM_FORMAT_INVALID', 'checksums.sha256 contains a malformed line')
      continue
    }
    const [, digest, name] = match
    if (seen.has(name)) {
      addError('CHECKSUM_DUPLICATE', 'checksums.sha256 contains duplicate entry names')
    }
    seen.add(name)
    if (name === 'checksums.sha256') {
      addError('CHECKSUM_UNEXPECTED_ENTRY', 'checksums.sha256 must not cover itself')
      continue
    }
    const entry = archive.map.get(name)
    if (!entry) {
      addError('CHECKSUM_MISSING_ENTRY', 'checksums.sha256 references a missing entry')
      continue
    }
    if (sha256Hex(entry.data) !== digest) {
      addError('CHECKSUM_MISMATCH', 'checksums.sha256 digest does not match entry content')
    }
    if (name.startsWith('blobs/') && name.slice('blobs/'.length) !== digest) {
      addError('BLOB_NAME_MISMATCH', 'blob entry name does not equal its content digest')
    }
  }
  const expectedNames = [...archive.map.keys()].filter((name) => name !== 'checksums.sha256').sort()
  for (const name of expectedNames) {
    if (!seen.has(name)) {
      addError('CHECKSUM_MISSING_ENTRY', 'checksums.sha256 does not cover an exported entry')
    }
  }
  for (const name of seen) {
    if (!archive.map.has(name)) continue
    if (!expectedNames.includes(name)) {
      addError('CHECKSUM_UNEXPECTED_ENTRY', 'checksums.sha256 covers an unknown entry')
    }
  }
}

function validateBlobFiles(manifest, archive, addError) {
  if (!manifest) return
  const expected = new Set(manifest.blobs.map((blob) => `blobs/${blob.sha256}`))
  for (const blob of manifest.blobs) {
    const entry = archive.map.get(`blobs/${blob.sha256}`)
    if (!entry) {
      addError('BLOB_FILE_MISSING', 'manifest blob is missing from the ZIP')
      continue
    }
    if (entry.data.length !== blob.byteSize) {
      addError('BLOB_FILE_MISMATCH', 'blob byte size does not match manifest')
    }
    if (sha256Hex(entry.data) !== blob.sha256) {
      addError('BLOB_FILE_MISMATCH', 'blob content digest does not match manifest')
    }
  }
  for (const name of archive.map.keys()) {
    if (BLOB_ENTRY_PATTERN.test(name) && !expected.has(name)) {
      addError('BLOB_FILE_MISMATCH', 'ZIP contains a blob not listed in manifest')
    }
  }
}

function sanitizeDisplayPath(inputPath) {
  if (!inputPath) return null
  const absolute = resolve(inputPath)
  const relativePath = relative(process.cwd(), absolute)
  if (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  ) {
    return relativePath.split(sep).join('/')
  }
  return basename(absolute)
}

function finishReport({ bytes, sourcePath, now, errors, checks, archive, manifest }) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    status: errors.length === 0 ? 'pass' : 'fail',
    generatedAt: (now instanceof Date ? now : new Date()).toISOString(),
    artifact: {
      path: sanitizeDisplayPath(sourcePath),
      byteSize: bytes.length,
      sha256: sha256Hex(bytes),
      entryCount: archive ? archive.entries.length : null
    },
    manifest: manifest ? manifest.summary : null,
    checks,
    errors
  }
}

export function verifyBackupBytes(sourceBytes, options = {}) {
  const bytes = Buffer.isBuffer(sourceBytes) ? sourceBytes : Buffer.from(sourceBytes)
  const errors = []
  const checks = {
    zipStructure: false,
    entrySetExact: false,
    checksumsValid: false,
    manifestValid: false,
    schemaValid: false,
    entitiesValid: false,
    blobFilesValid: false,
    textSafe: false
  }
  const addError = (code, message, entry = null) => {
    if (errors.length >= 100) return
    errors.push(entry === null ? { code, message } : { code, message, entry })
  }

  let archive
  try {
    archive = parseZip(bytes)
    checks.zipStructure = true
  } catch (error) {
    addError(
      error instanceof ZipParseError ? error.code : 'ZIP_INVALID',
      error instanceof Error ? error.message : 'ZIP could not be parsed'
    )
    return finishReport({
      bytes,
      sourcePath: options.sourcePath,
      now: options.now,
      errors,
      checks,
      archive: null,
      manifest: null
    })
  }

  const readText = (name, code) => {
    const entry = archive.map.get(name)
    if (!entry) return null
    try {
      return decodeUtf8(entry.data)
    } catch {
      addError(code, `${name} is not valid UTF-8`)
      return null
    }
  }

  const manifestStart = errors.length
  const manifestText = readText('manifest.json', 'MANIFEST_INVALID')
  let manifest = null
  if (manifestText === null) {
    addError('MANIFEST_INVALID', 'manifest.json is missing')
  } else {
    let value
    try {
      value = JSON.parse(manifestText)
    } catch {
      addError('MANIFEST_INVALID_JSON', 'manifest.json is not valid JSON')
    }
    if (value !== undefined) manifest = validateManifest(value, addError)
  }
  checks.manifestValid = manifest !== null && errors.length === manifestStart

  const entrySetStart = errors.length
  const expectedEntries = new Set(FIXED_ENTRIES)
  if (manifest) {
    for (const blob of manifest.blobs) expectedEntries.add(`blobs/${blob.sha256}`)
  }
  for (const name of expectedEntries) {
    if (!archive.map.has(name)) addError('ZIP_MISSING_ENTRY', 'required backup entry is missing', name)
  }
  for (const name of archive.map.keys()) {
    if (!expectedEntries.has(name)) {
      addError('ZIP_UNEXPECTED_ENTRY', 'ZIP contains an unexpected entry', name)
    }
  }
  checks.entrySetExact = errors.length === entrySetStart

  const checksumsStart = errors.length
  const checksumsText = readText('checksums.sha256', 'CHECKSUM_FORMAT_INVALID')
  if (checksumsText === null) {
    addError('CHECKSUM_FORMAT_INVALID', 'checksums.sha256 is missing')
  } else {
    validateChecksums(checksumsText, archive, addError)
  }
  checks.checksumsValid = errors.length === checksumsStart

  const schemaStart = errors.length
  const schemaText = readText('schema/versions.json', 'SCHEMA_INVALID')
  if (schemaText === null) {
    addError('SCHEMA_INVALID', 'schema/versions.json is missing')
  } else {
    let schema
    try {
      schema = JSON.parse(schemaText)
    } catch {
      addError('SCHEMA_INVALID', 'schema/versions.json is not valid JSON')
    }
    if (schema !== undefined) validateSchema(schema, manifest, addError)
  }
  checks.schemaValid = errors.length === schemaStart

  const entitiesStart = errors.length
  const entitiesText = readText('database/entities.jsonl', 'ENTITIES_INVALID')
  if (entitiesText === null) {
    addError('ENTITIES_INVALID', 'database/entities.jsonl is missing')
  } else {
    validateEntities(entitiesText, manifest, addError)
  }
  checks.entitiesValid = errors.length === entitiesStart

  const blobStart = errors.length
  if (manifest === null) {
    addError('BLOB_FILE_MISMATCH', 'blob files cannot be validated without a manifest')
  } else {
    validateBlobFiles(manifest, archive, addError)
  }
  checks.blobFilesValid = errors.length === blobStart

  const textStart = errors.length
  for (const name of FIXED_ENTRIES) {
    const entry = archive.map.get(name)
    if (!entry) continue
    let text
    try {
      text = decodeUtf8(entry.data)
    } catch {
      addError('TEXT_DECODE_FAILED', 'backup text entry is not valid UTF-8', name)
      continue
    }
    for (const rule of LEAK_PATTERNS) {
      if (rule.pattern.test(text)) {
        addError('SENSITIVE_DATA_LEAK', `backup text entry matches ${rule.code}`, name)
      }
    }
  }
  checks.textSafe = errors.length === textStart

  return finishReport({
    bytes,
    sourcePath: options.sourcePath,
    now: options.now,
    errors,
    checks,
    archive,
    manifest
  })
}

export function verifyBackupFile(filePath, options = {}) {
  return verifyBackupBytes(readFileSync(filePath), {
    ...options,
    sourcePath: filePath
  })
}

function usage() {
  return 'Usage: node scripts/verify-backup.mjs <character-export.zip> [--json <report.json>]'
}

function parseArgs(argv) {
  let zipPath = null
  let jsonPath = null
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') return { help: true }
    if (argument === '--json') {
      const value = argv[index + 1]
      if (!value) return { error: '--json requires a value' }
      jsonPath = value
      index += 1
      continue
    }
    if (argument.startsWith('-')) return { error: `unknown option ${argument}` }
    if (zipPath !== null) return { error: 'only one ZIP path may be provided' }
    zipPath = argument
  }
  if (!zipPath) return { error: 'a ZIP path is required' }
  return { zipPath, jsonPath }
}

function main(argv) {
  const parsed = parseArgs(argv)
  if (parsed.help) {
    process.stdout.write(`${usage()}\n`)
    return 0
  }
  if (parsed.error) {
    process.stderr.write(`${parsed.error}\n${usage()}\n`)
    return 2
  }

  let report
  try {
    report = verifyBackupFile(parsed.zipPath)
  } catch {
    process.stderr.write('verify-backup: unable to read the input ZIP\n')
    return 2
  }

  if (parsed.jsonPath) {
    try {
      const target = resolve(parsed.jsonPath)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      })
    } catch {
      process.stderr.write('verify-backup: unable to write the JSON report\n')
      return 2
    }
  }

  if (report.status === 'pass') {
    process.stdout.write(
      `backup verification passed: ${report.artifact.entryCount} entries, ` +
        `${report.artifact.byteSize} bytes, sha256 ${report.artifact.sha256}\n`
    )
    return 0
  }
  const codes = [...new Set(report.errors.map((error) => error.code))].join(', ')
  process.stderr.write(`backup verification failed: ${report.errors.length} error(s) [${codes}]\n`)
  return 1
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
