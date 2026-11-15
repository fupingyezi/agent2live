import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PROMPT_WORKBENCH_PAGES, PROVIDER_PAGES, UI_EVIDENCE_PAGES } from './phase1-gate.mjs'
import { evaluateConvergenceGate } from './phase1-convergence-gate.mjs'

const PAGE_NAMES = [...UI_EVIDENCE_PAGES]

const REFERENCE_HASH = 'a'.repeat(64)

function passingPhase1Gate() {
  return {
    overallStatus: 'pass',
    exitCode: 0,
    problems: [],
    evidence: {
      uiAxe: 'ok',
      uiTokenLint: 'ok',
      uiVisuals: {
        required: 11,
        valid: 11,
        promptWorkbench: { required: 10, valid: 10 },
        providerS8: { required: 1, valid: 1 }
      }
    }
  }
}

function reference() {
  return {
    schemaVersion: 'ui-reference/1',
    sha256: REFERENCE_HASH,
    pages: PAGE_NAMES.map((name) => ({ name }))
  }
}

function designReview(overrides = {}) {
  return {
    schemaVersion: 'ui-design-review/1',
    status: 'approved',
    reviewedAt: '2026-11-15T00:00:00Z',
    reviewer: 'local-user',
    referenceSha256: REFERENCE_HASH,
    pages: PAGE_NAMES.map((name) => ({ name, status: 'approved', issues: [] })),
    ...overrides
  }
}

function realProviders(overrides = {}) {
  return {
    schemaVersion: 'real-providers/1',
    status: 'pass',
    checks: {
      chat: { ok: true },
      image: { ok: true }
    },
    ...overrides
  }
}

function realVision(overrides = {}) {
  return {
    schemaVersion: 'real-vision/1',
    status: 'pass',
    schemaPass: true,
    warningCount: 0,
    ...overrides
  }
}

describe('phase 1 convergence gate', () => {
  it('publishes the shared ten-plus-one evidence page inventory', () => {
    assert.equal(PROMPT_WORKBENCH_PAGES.length, 10)
    assert.deepEqual([...PROVIDER_PAGES], ['providers'])
    assert.equal(UI_EVIDENCE_PAGES.length, 11)
  })

  it('blocks when the design sign-off is missing', () => {
    const result = evaluateConvergenceGate({
      phase1Gate: passingPhase1Gate(),
      designReview: null,
      reference: reference(),
      realProviders: realProviders(),
      realVision: realVision(),
      requireRealProviders: false
    })

    assert.equal(result.overallStatus, 'blocked')
    assert.equal(result.exitCode, 2)
    assert.equal(result.categories['DESIGN-REVIEW'].status, 'blocked')
  })

  it('fails when the sign-off references different design bytes', () => {
    const result = evaluateConvergenceGate({
      phase1Gate: passingPhase1Gate(),
      designReview: designReview({ referenceSha256: 'b'.repeat(64) }),
      reference: reference(),
      realProviders: realProviders(),
      realVision: realVision(),
      requireRealProviders: false
    })

    assert.equal(result.overallStatus, 'fail')
    assert.equal(result.categories['DESIGN-REVIEW'].status, 'fail')
    assert.match(result.problems.join('\n'), /reference SHA-256/)
  })

  it('fails when any design page is not approved', () => {
    const review = designReview()
    const index = review.pages.findIndex((page) => page.name === 'character-card')
    review.pages[index] = {
      name: review.pages[index].name,
      status: 'changes_requested',
      issues: [{ severity: 'P1', summary: 'layout differs' }]
    }
    const result = evaluateConvergenceGate({
      phase1Gate: passingPhase1Gate(),
      designReview: review,
      reference: reference(),
      realProviders: realProviders(),
      realVision: realVision(),
      requireRealProviders: false
    })

    assert.equal(result.overallStatus, 'fail')
    assert.match(result.problems.join('\n'), /character-card is not approved/)
  })

  it('blocks required real-provider evidence when the file is missing', () => {
    const result = evaluateConvergenceGate({
      phase1Gate: passingPhase1Gate(),
      designReview: designReview(),
      reference: reference(),
      realProviders: null,
      realVision: null,
      requireRealProviders: true
    })

    assert.equal(result.overallStatus, 'blocked')
    assert.equal(result.categories['REAL-CHAT'].status, 'blocked')
    assert.equal(result.categories['REAL-IMAGE'].status, 'blocked')
    assert.equal(result.categories['REAL-VISION'].status, 'blocked')
  })

  it('fails when either real-provider check did not succeed', () => {
    const result = evaluateConvergenceGate({
      phase1Gate: passingPhase1Gate(),
      designReview: designReview(),
      reference: reference(),
      realProviders: realProviders({
        checks: {
          chat: { ok: true },
          image: { ok: false, errorCode: 'PROVIDER_UNAVAILABLE' }
        }
      }),
      realVision: realVision(),
      requireRealProviders: true
    })

    assert.equal(result.overallStatus, 'fail')
    assert.equal(result.categories['REAL-CHAT'].status, 'pass')
    assert.equal(result.categories['REAL-IMAGE'].status, 'fail')
  })

  it('keeps a successful image-only smoke separate from the missing chat check', () => {
    const result = evaluateConvergenceGate({
      phase1Gate: passingPhase1Gate(),
      designReview: designReview(),
      reference: reference(),
      realProviders: {
        schemaVersion: 'real-providers/1',
        status: 'partial',
        checks: {
          image: { ok: true }
        }
      },
      realVision: realVision(),
      requireRealProviders: true
    })

    assert.equal(result.overallStatus, 'blocked')
    assert.equal(result.exitCode, 2)
    assert.equal(result.categories['REAL-CHAT'].status, 'blocked')
    assert.equal(result.categories['REAL-IMAGE'].status, 'pass')
  })

  it('passes only when Phase 1, design review, and both real probes pass', () => {
    const result = evaluateConvergenceGate({
      phase1Gate: passingPhase1Gate(),
      designReview: designReview(),
      reference: reference(),
      realProviders: realProviders(),
      realVision: realVision(),
      requireRealProviders: true
    })

    assert.equal(result.overallStatus, 'pass')
    assert.equal(result.exitCode, 0)
    assert.deepEqual(result.problems, [])
  })
})
