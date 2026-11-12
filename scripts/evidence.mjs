import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

const ROOT = resolve('.')
const STATUS = new Set(['pass', 'fail', 'blocked'])
const MODES = new Set(['real', 'mock'])

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function artifact(path) {
  const file = resolve(ROOT, path)
  const rel = relative(ROOT, file)
  if (!rel || rel.startsWith('..') || !existsSync(file)) {
    throw new Error(`EVIDENCE_ARTIFACT_INVALID:${path}`)
  }
  return { path: rel.split('\\').join('/'), sha256: sha256(file) }
}

export function writeEvidence(file, input) {
  if (!input.gate || !STATUS.has(input.status) || !MODES.has(input.mode)) {
    throw new Error('EVIDENCE_INPUT_INVALID')
  }
  const artifacts = [...(input.artifactPaths ?? [])].map(artifact)
  const envelope = {
    schemaVersion: 'evidence/1',
    gate: input.gate,
    status: input.status,
    mode: input.mode,
    recordedAt: new Date().toISOString(),
    sourceCommit: git(['rev-parse', 'HEAD']),
    dirty: Boolean(git(['status', '--porcelain'])),
    machine: {
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      electron: process.versions.electron ?? null
    },
    versions: input.versions ?? { node: process.versions.node },
    commands: input.commands ?? [],
    blocker: input.blocker ?? null,
    nextAction: input.nextAction ?? '',
    data: input.data ?? {},
    artifacts
  }
  const target = resolve(ROOT, file)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 })
  return envelope
}

export function readEvidence(file, expectedGate) {
  const target = resolve(ROOT, file)
  if (!existsSync(target)) throw new Error(`EVIDENCE_MISSING:${file}`)
  const value = JSON.parse(readFileSync(target, 'utf8'))
  if (
    value.schemaVersion !== 'evidence/1' ||
    value.gate !== expectedGate ||
    !STATUS.has(value.status) ||
    !MODES.has(value.mode) ||
    !Array.isArray(value.commands) ||
    !value.machine ||
    !value.versions ||
    !Array.isArray(value.artifacts)
  ) {
    throw new Error(`EVIDENCE_SCHEMA_INVALID:${file}`)
  }
  const currentCommit = git(['rev-parse', 'HEAD'])
  const dirty = Boolean(git(['status', '--porcelain']))
  if (value.status === 'pass' && (!currentCommit || value.sourceCommit !== currentCommit || dirty)) {
    throw new Error(`EVIDENCE_STALE:${file}`)
  }
  const commitSeconds = Number(git(['show', '-s', '--format=%ct', 'HEAD']) ?? '0')
  const commitTimeMs = commitSeconds * 1000
  const seen = new Set()
  for (const entry of value.artifacts) {
    if (!entry || typeof entry.path !== 'string' || seen.has(entry.path)) {
      throw new Error(`EVIDENCE_ARTIFACT_INVALID:${file}`)
    }
    seen.add(entry.path)
    const actual = artifact(entry.path)
    if (actual.sha256 !== entry.sha256) throw new Error(`EVIDENCE_ARTIFACT_TAMPERED:${file}`)
    if (
      value.status === 'pass' &&
      entry.path.startsWith('docs/plans/evidence/') &&
      statSync(resolve(ROOT, entry.path)).mtimeMs + 1_000 < commitTimeMs
    ) {
      throw new Error(`EVIDENCE_STALE_ARTIFACT:${entry.path}`)
    }
  }
  return value
}
