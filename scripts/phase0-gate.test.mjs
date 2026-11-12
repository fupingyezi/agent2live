import assert from 'node:assert/strict'
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  aggregateChecks,
  aggregateGateStatuses,
  completedGate,
  matrixPass,
  playwrightSummary,
  rendererPass,
  vitestSummary
} from './phase0-gate.mjs'
import { readEvidence, writeEvidence } from './evidence.mjs'

test('playwrightSummary passes only when tests ran and none were unexpected', () => {
  assert.deepEqual(playwrightSummary({ stats: { expected: 3, unexpected: 0, skipped: 1 } }), {
    pass: true,
    expected: 3,
    unexpected: 0,
    skipped: 1
  })
  assert.equal(playwrightSummary({ stats: { expected: 3, unexpected: 1, skipped: 0 } }).pass, false)
  assert.equal(playwrightSummary({ stats: { expected: 0, unexpected: 0, skipped: 0 } }).pass, false)
  assert.equal(playwrightSummary({}).pass, false)
})

test('vitestSummary passes only on a successful non-empty run', () => {
  assert.deepEqual(vitestSummary({ success: true, numTotalTests: 5, numPassedTests: 5, numFailedTests: 0 }), {
    pass: true,
    total: 5,
    passed: 5,
    failed: 0
  })
  assert.equal(
    vitestSummary({ success: false, numTotalTests: 5, numPassedTests: 4, numFailedTests: 1 }).pass,
    false
  )
  assert.equal(
    vitestSummary({ success: true, numTotalTests: 0, numPassedTests: 0, numFailedTests: 0 }).pass,
    false
  )
  assert.equal(vitestSummary({}).pass, false)
})

test('aggregateGateStatuses lets fail dominate blocked', () => {
  assert.equal(aggregateGateStatuses([{ status: 'pass' }, { status: 'pass' }]), 'pass')
  assert.equal(aggregateGateStatuses([{ status: 'pass' }, { status: 'blocked' }]), 'blocked')
  assert.equal(aggregateGateStatuses([{ status: 'blocked' }, { status: 'fail' }]), 'fail')
  assert.equal(aggregateGateStatuses([{ status: 'pass' }, { status: 'unknown' }]), 'fail')
  assert.equal(aggregateGateStatuses([]), 'fail')
})

test('aggregateChecks lets a failed check outrank missing evidence', () => {
  assert.equal(aggregateChecks({ a: true, b: true }), 'pass')
  assert.equal(aggregateChecks({ a: true, b: 'missing' }), 'blocked')
  assert.equal(aggregateChecks({ a: false, b: 'missing' }), 'fail')
  assert.equal(aggregateChecks({ a: false, b: true }), 'fail')
})

test('completedGate lets a failed check outrank missing evidence', () => {
  assert.equal(completedGate('G0-T', { a: true, b: true }, 'MISSING', 'FAILED').status, 'pass')
  assert.equal(completedGate('G0-T', { a: true, b: 'missing' }, 'MISSING', 'FAILED').status, 'blocked')
  assert.equal(completedGate('G0-T', { a: false, b: 'missing' }, 'MISSING', 'FAILED').status, 'fail')
  assert.equal(completedGate('G0-T', { a: false, b: true }, 'MISSING', 'FAILED').blocker, 'FAILED')
})

test('rendererPass requires load, animation, idle, parameters, and Core version', () => {
  const renderer = {
    loaded: true,
    animated: true,
    idle: true,
    requiredParameters: true,
    coreVersion: '5.3.0.1'
  }
  assert.equal(rendererPass(renderer), true)
  assert.equal(rendererPass({ ...renderer, animated: false }), false)
  assert.equal(rendererPass({ ...renderer, coreVersion: null }), false)
})

test('matrixPass rejects a Studio-only result', () => {
  const renderer = {
    loaded: true,
    animated: true,
    idle: true,
    requiredParameters: true,
    coreVersion: '5.3.0.1'
  }
  const entry = {
    label: 'seeThrough',
    loaded: true,
    animated: true,
    renderers: { studio: renderer, pet: { ...renderer, loaded: false } }
  }
  assert.equal(matrixPass({ status: 'pass', results: [entry] }, ['seeThrough']), false)
  assert.equal(
    matrixPass(
      {
        status: 'pass',
        results: [{ ...entry, renderers: { studio: renderer, pet: renderer } }]
      },
      ['seeThrough']
    ),
    true
  )
})

test('evidence envelopes reject stale artifacts and tampered hashes', () => {
  const raw = 'docs/plans/evidence/phase0/G0-T/raw.json'
  mkdirSync(join('docs/plans/evidence/phase0/G0-T'), { recursive: true })
  writeFileSync(raw, '{}')
  const file = 'docs/plans/evidence/phase0/G0-T/test.json'
  writeEvidence(file, {
    gate: 'G0-T',
    status: 'pass',
    mode: 'real',
    data: {},
    artifactPaths: [raw]
  })
  try {
    utimesSync(raw, 0, 0)
    assert.throws(() => readEvidence(file, 'G0-T'), /STALE_ARTIFACT/)
    writeFileSync(raw, '{"tampered":true}')
    assert.throws(() => readEvidence(file, 'G0-T'), /TAMPERED/)
  } finally {
    rmSync(file, { force: true })
    rmSync(raw, { force: true })
  }
})
