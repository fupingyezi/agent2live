import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const SCHEMA_VERSION = 'phase0.5-quality-gate/1'
export const QUALITY_GATE_ID = 'G0.5-QUALITY'
export const GATE_EVIDENCE_PATH = 'docs/plans/evidence/phase0.5/gate.json'
export const REQUIRED_CHECKS = [
  'format',
  'codeStyle',
  'typecheckWorkspace',
  'typecheckRoot',
  'typecheckE2e',
  'typecheckSpikes',
  'unit',
  'build',
  'electronShell',
  'sharedContracts'
]

const CHECK_STATUSES = new Set(['pass', 'fail', 'blocked'])
const COMMIT_PATTERN = /^[0-9a-f]{40}$/

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function orderedIds(ids) {
  return [...new Set(ids)].sort((left, right) => {
    const leftIndex = REQUIRED_CHECKS.indexOf(left)
    const rightIndex = REQUIRED_CHECKS.indexOf(right)
    if (leftIndex !== -1 && rightIndex !== -1) return leftIndex - rightIndex
    if (leftIndex !== -1) return -1
    if (rightIndex !== -1) return 1
    return left < right ? -1 : left > right ? 1 : 0
  })
}

function duplicateIds(ids) {
  const counts = new Map()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  return orderedIds([...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id))
}

export function validArtifactManifest(artifacts) {
  if (!Array.isArray(artifacts)) return false
  const ids = []
  for (const entry of artifacts) {
    if (!isPlainObject(entry) || typeof entry.id !== 'string') return false
    ids.push(entry.id)
  }
  if (ids.length !== REQUIRED_CHECKS.length) return false
  if (orderedIds(ids).length !== REQUIRED_CHECKS.length) return false
  if (ids.some((id) => !REQUIRED_CHECKS.includes(id))) return false
  return REQUIRED_CHECKS.every((id) => ids.filter((value) => value === id).length === 1)
}

export function evaluatePhase05Gate(input = {}) {
  const { evidence, repository, artifacts } = input ?? {}
  if (evidence === undefined) {
    return { status: 'blocked', blockers: ['EVIDENCE_MISSING'] }
  }
  if (!isPlainObject(evidence)) {
    return { status: 'fail', blockers: ['SCHEMA_INVALID'] }
  }

  const structural = new Set()
  if (evidence.schemaVersion !== SCHEMA_VERSION) structural.add('SCHEMA_INVALID')
  if (evidence.gate !== QUALITY_GATE_ID) structural.add('GATE_MISMATCH')

  let failed = []
  let blocked = []
  if (!Array.isArray(evidence.checks)) {
    structural.add('SCHEMA_INVALID')
  } else {
    const ids = []
    const statuses = new Map()
    for (const entry of evidence.checks) {
      if (!isPlainObject(entry) || typeof entry.id !== 'string') {
        structural.add('SCHEMA_INVALID')
        continue
      }
      ids.push(entry.id)
      if (!statuses.has(entry.id)) statuses.set(entry.id, [])
      statuses.get(entry.id).push(entry.status)
      if (!CHECK_STATUSES.has(entry.status)) structural.add('CHECK_STATUS_INVALID')
    }
    const missing = REQUIRED_CHECKS.filter((id) => !ids.includes(id))
    const duplicate = duplicateIds(ids)
    const unknown = orderedIds(ids.filter((id) => !REQUIRED_CHECKS.includes(id)))
    if (missing.length > 0) structural.add(`CHECKS_MISSING:${missing.join(',')}`)
    if (duplicate.length > 0) structural.add(`CHECKS_DUPLICATE:${duplicate.join(',')}`)
    if (unknown.length > 0) structural.add(`CHECKS_UNKNOWN:${unknown.join(',')}`)
    const everyStatusUsable = [...statuses.values()].every(
      (values) => values.length === 1 && CHECK_STATUSES.has(values[0])
    )
    if (missing.length === 0 && duplicate.length === 0 && unknown.length === 0 && everyStatusUsable) {
      failed = REQUIRED_CHECKS.filter((id) => statuses.get(id)[0] === 'fail')
      blocked = REQUIRED_CHECKS.filter((id) => statuses.get(id)[0] === 'blocked')
    }
  }

  const head = isPlainObject(repository) ? repository.head : null
  if (
    typeof evidence.sourceCommit !== 'string' ||
    !COMMIT_PATTERN.test(evidence.sourceCommit) ||
    evidence.sourceCommit !== head
  ) {
    structural.add('SOURCE_COMMIT_MISMATCH')
  }
  if (evidence.dirty !== false || !isPlainObject(repository) || repository.dirty !== false) {
    structural.add('WORKTREE_DIRTY')
  }
  if (!validArtifactManifest(artifacts)) structural.add('ARTIFACTS_INVALID')

  const blockers = [...structural]
  if (failed.length > 0) blockers.push(`CHECKS_FAILED:${failed.join(',')}`)
  if (blocked.length > 0) blockers.push(`CHECKS_BLOCKED:${blocked.join(',')}`)
  const status = structural.size > 0 || failed.length > 0 ? 'fail' : blocked.length > 0 ? 'blocked' : 'pass'
  return { status, blockers }
}

export function repositoryState() {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
    return { head, dirty: status.trim() !== '' }
  } catch {
    return { head: null, dirty: true }
  }
}

function loadEvidence(file) {
  if (!existsSync(file)) return { kind: 'missing' }
  try {
    return { kind: 'present', value: JSON.parse(readFileSync(file, 'utf8')) }
  } catch {
    return { kind: 'invalid' }
  }
}

export function runPhase05Gate(file = resolve(GATE_EVIDENCE_PATH)) {
  const loaded = loadEvidence(file)
  let result
  if (loaded.kind === 'missing') {
    result = { status: 'blocked', blockers: ['EVIDENCE_MISSING'] }
  } else if (loaded.kind === 'invalid') {
    result = { status: 'fail', blockers: ['SCHEMA_INVALID'] }
  } else {
    result = evaluatePhase05Gate({
      evidence: loaded.value,
      repository: repositoryState(),
      artifacts: isPlainObject(loaded.value) ? loaded.value.artifacts : undefined
    })
  }
  console.log(
    JSON.stringify({ status: result.status, blockers: result.blockers, report: GATE_EVIDENCE_PATH }, null, 2)
  )
  return result.status === 'pass' ? 0 : result.status === 'blocked' ? 2 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runPhase05Gate()
}
