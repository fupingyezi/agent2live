import assert from 'node:assert/strict'
import test from 'node:test'
import { QUALITY_GATE_ID, REQUIRED_CHECKS, SCHEMA_VERSION, evaluatePhase05Gate } from './phase0.5-gate.mjs'
import { runGuardedCheck } from './write-phase0.5-evidence.mjs'

const HEAD = 'a'.repeat(40)

function validEvidence(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    gate: QUALITY_GATE_ID,
    status: 'pass',
    sourceCommit: HEAD,
    dirty: false,
    checks: REQUIRED_CHECKS.map((id) => ({ id, status: 'pass' })),
    ...overrides
  }
}

function validArtifacts() {
  return REQUIRED_CHECKS.map((id) => ({ id, exitCode: 0, durationMs: 1 }))
}

function evaluate(evidence, repository = { head: HEAD, dirty: false }, artifacts = validArtifacts()) {
  return evaluatePhase05Gate({ evidence, repository, artifacts })
}

test('passes only when every quality check and source commit is valid', () => {
  const result = evaluate(validEvidence())
  assert.equal(result.status, 'pass')
  assert.deepEqual(result.blockers, [])
})

test('fail outranks blocked', () => {
  const evidence = validEvidence()
  evidence.checks.find((entry) => entry.id === 'typecheckWorkspace').status = 'fail'
  evidence.checks.find((entry) => entry.id === 'build').status = 'blocked'
  const result = evaluate(evidence)
  assert.equal(result.status, 'fail')
  assert.ok(result.blockers.includes('CHECKS_FAILED:typecheckWorkspace'))
  assert.ok(result.blockers.includes('CHECKS_BLOCKED:build'))
})

test('blocks when every check is blocked and none failed', () => {
  const evidence = validEvidence()
  for (const entry of evidence.checks) entry.status = 'blocked'
  const result = evaluate(evidence)
  assert.equal(result.status, 'blocked')
  assert.ok(result.blockers.includes(`CHECKS_BLOCKED:${REQUIRED_CHECKS.join(',')}`))
})

test('rejects stale evidence from a different or dirty commit', () => {
  const evidence = validEvidence()
  evidence.sourceCommit = 'b'.repeat(40)
  const result = evaluate(evidence, { head: HEAD, dirty: true })
  assert.equal(result.status, 'fail')
  assert.ok(result.blockers.includes('SOURCE_COMMIT_MISMATCH'))
  assert.ok(result.blockers.includes('WORKTREE_DIRTY'))
})

test('requires a clean repository and a matching commit to pass', () => {
  assert.equal(evaluate(validEvidence()).status, 'pass')
  assert.equal(evaluate(validEvidence(), { head: HEAD, dirty: true }).status, 'fail')
  assert.equal(
    evaluate(validEvidence({ sourceCommit: 'b'.repeat(40) }), { head: HEAD, dirty: false }).status,
    'fail'
  )
})

test('fails when the evidence record is dirty', () => {
  const result = evaluate(validEvidence({ dirty: true }))
  assert.equal(result.status, 'fail')
  assert.ok(result.blockers.includes('WORKTREE_DIRTY'))
})

test('rejects an unsupported schema version', () => {
  const result = evaluate(validEvidence({ schemaVersion: 'phase0.5-quality-gate/2' }))
  assert.equal(result.status, 'fail')
  assert.ok(result.blockers.includes('SCHEMA_INVALID'))
})

test('rejects a different gate id', () => {
  const result = evaluate(validEvidence({ gate: 'G0-QUALITY' }))
  assert.equal(result.status, 'fail')
  assert.ok(result.blockers.includes('GATE_MISMATCH'))
})

test('rejects a missing check id', () => {
  const evidence = validEvidence()
  evidence.checks = evidence.checks.filter((entry) => entry.id !== 'build')
  const result = evaluate(evidence)
  assert.equal(result.status, 'fail')
  assert.ok(result.blockers.includes('CHECKS_MISSING:build'))
})

test('rejects a duplicate check id', () => {
  const evidence = validEvidence()
  evidence.checks.push({ id: 'unit', status: 'pass' })
  const result = evaluate(evidence)
  assert.equal(result.status, 'fail')
  assert.ok(result.blockers.includes('CHECKS_DUPLICATE:unit'))
})

test('rejects an unknown check id', () => {
  const evidence = validEvidence()
  evidence.checks.push({ id: 'lint', status: 'pass' })
  const result = evaluate(evidence)
  assert.equal(result.status, 'fail')
  assert.ok(result.blockers.includes('CHECKS_UNKNOWN:lint'))
})

test('rejects an invalid check status', () => {
  const evidence = validEvidence()
  evidence.checks.find((entry) => entry.id === 'format').status = 'skipped'
  const result = evaluate(evidence)
  assert.equal(result.status, 'fail')
  assert.ok(result.blockers.includes('CHECK_STATUS_INVALID'))
})

test('rejects a source commit that is not 40 lowercase hex characters', () => {
  assert.equal(evaluate(validEvidence({ sourceCommit: 'A'.repeat(40) })).status, 'fail')
  assert.equal(evaluate(validEvidence({ sourceCommit: 'abc' })).status, 'fail')
})

test('rejects a missing artifact entry', () => {
  const artifacts = validArtifacts().filter((entry) => entry.id !== 'build')
  const result = evaluate(validEvidence(), undefined, artifacts)
  assert.equal(result.status, 'fail')
  assert.ok(result.blockers.includes('ARTIFACTS_INVALID'))
})

test('rejects a duplicate artifact entry', () => {
  const artifacts = validArtifacts()
  artifacts.push({ id: 'unit', exitCode: 0, durationMs: 2 })
  const result = evaluate(validEvidence(), undefined, artifacts)
  assert.equal(result.status, 'fail')
  assert.ok(result.blockers.includes('ARTIFACTS_INVALID'))
})

test('rejects an unknown artifact entry', () => {
  const artifacts = validArtifacts()
  artifacts.push({ id: 'lint', exitCode: 0, durationMs: 2 })
  const result = evaluate(validEvidence(), undefined, artifacts)
  assert.equal(result.status, 'fail')
  assert.ok(result.blockers.includes('ARTIFACTS_INVALID'))
})

test('allows extra keys on artifact entries', () => {
  const artifacts = validArtifacts().map((entry) => ({ ...entry, captured: true }))
  assert.equal(evaluate(validEvidence(), undefined, artifacts).status, 'pass')
})

test('blocks when evidence is missing', () => {
  assert.deepEqual(evaluatePhase05Gate({}), { status: 'blocked', blockers: ['EVIDENCE_MISSING'] })
  assert.deepEqual(evaluate(undefined), { status: 'blocked', blockers: ['EVIDENCE_MISSING'] })
  assert.deepEqual(evaluatePhase05Gate(null), { status: 'blocked', blockers: ['EVIDENCE_MISSING'] })
})

test('rejects null evidence as present but invalid', () => {
  assert.deepEqual(evaluate(null), { status: 'fail', blockers: ['SCHEMA_INVALID'] })
  assert.equal(evaluatePhase05Gate({ evidence: null, repository: null, artifacts: null }).status, 'fail')
})

test('does not throw on malformed input and fails closed', () => {
  assert.deepEqual(evaluatePhase05Gate(), { status: 'blocked', blockers: ['EVIDENCE_MISSING'] })
  assert.doesNotThrow(() => evaluatePhase05Gate({ evidence: null, repository: null, artifacts: null }))
  assert.equal(evaluate('not-an-object').status, 'fail')
  assert.equal(evaluate(validEvidence({ checks: 'not-an-array' })).status, 'fail')
  assert.equal(
    evaluatePhase05Gate({ evidence: validEvidence(), repository: null, artifacts: null }).status,
    'fail'
  )
})

test('turns a throwing check into a failed check instead of a crash', () => {
  const entry = {
    id: 'format',
    command: 'pnpm format:check',
    run: () => {
      throw new Error('boom /Users/private')
    }
  }
  const result = runGuardedCheck(entry, '/tmp/agent2live-test')
  assert.equal(result.command, 'pnpm format:check')
  assert.equal(result.status, 'fail')
  assert.equal(result.exitCode, -1)
  assert.equal(result.summary, 'internal error')
  assert.ok(Number.isInteger(result.durationMs) && result.durationMs >= 0)
  assert.ok(!JSON.stringify(result).includes('/Users/private'))
})
