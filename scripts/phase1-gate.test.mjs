import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  BACKUP_ARTIFACT_PATH,
  MIN_ASSERTIONS_BY_FILE,
  PHASE1_GATES,
  PROMPT_WORKBENCH_PAGES,
  PROVIDER_PAGES,
  UI_EVIDENCE_PAGES,
  UI_TOKEN_RULES,
  UI_VISUAL_BASELINES,
  evaluatePhase1Gate,
  gateExitCode,
  renderGateMarkdown
} from './phase1-gate.mjs'

const ROOT = '/phase1-root'
const CHARACTER_ID = 'chr_01J00000000000000000000000'
const PROJECT_ID = 'artp_01J00000000000000000000000'
const CHILD_PROJECT_ID = 'artp_01J00000000000000000000001'
const BACKUP_ID = 'bkp_01J00000000000000000000000'
const BACKUP_JOB_ID = 'job_01J00000000000000000000000'
const BACKUP_ZIP = Buffer.from('phase1-gate-fixture-zip', 'utf8')
const BACKUP_SHA = createHash('sha256').update(BACKUP_ZIP).digest('hex')
const REQUIRED_VITEST = Object.values(PHASE1_GATES).flatMap((gate) => gate.tests)
const REQUIRED_PLAYWRIGHT = Object.values(PHASE1_GATES).flatMap((gate) => gate.playwright)
const GOLDEN_CHECKS = {
  uiCharacterAndProjectCreated: true,
  characterBriefCreated: true,
  promptInputsIngested: true,
  draftSavedAndCommitted: true,
  mockProviderCreated: true,
  generationSucceeded: true,
  candidateAccepted: true,
  manualVersionCreated: true,
  referenceRevisionCreated: true,
  rollbackActivated: true,
  artVersionForked: true,
  forkCopiedOrderedReferences: true,
  backupCompleted: true,
  backupDownloadVerified: true,
  cockpitVerified: true,
  workbenchVerified: true
}
const SSE_CHECKS = {
  replayedByQueryCursor: true,
  replayedPayloadMatches: true,
  secondEventIsNewer: true,
  seqStrictlyIncreasing: true
}
const VERIFICATION_CHECKS = {
  zipStructure: true,
  entrySetExact: true,
  checksumsValid: true,
  manifestValid: true,
  schemaValid: true,
  entitiesValid: true,
  blobFilesValid: true,
  textSafe: true
}

test('defines ten prompt-workbench pages and one independent provider page', () => {
  assert.equal(PROMPT_WORKBENCH_PAGES.length, 10)
  assert.deepEqual(
    [...PROMPT_WORKBENCH_PAGES],
    [
      'created-confirmation',
      'character-just-created',
      'overview',
      'new-character-empty',
      'new-character-full',
      'reference-editor',
      'reference-hover',
      'workbench-references',
      'workbench-candidates',
      'character-card'
    ]
  )
  assert.deepEqual([...PROVIDER_PAGES], ['providers'])
  assert.equal(UI_EVIDENCE_PAGES.length, 11)
})

test('reports prompt-workbench and provider screenshot gaps separately', () => {
  const missingPrompt = validEvidence()
  delete missingPrompt.visuals.overview
  const promptResult = evaluate({ evidence: missingPrompt })
  assert.match(promptResult.problems.map((problem) => problem.message).join('\n'), /Prompt workbench/)

  const missingProvider = validEvidence()
  delete missingProvider.visuals.providers
  const providerResult = evaluate({ evidence: missingProvider })
  const messages = providerResult.problems.map((problem) => problem.message).join('\n')
  assert.match(messages, /Provider S8/)
  assert.doesNotMatch(messages, /Prompt workbench.*providers/)
})

function ok(value) {
  return { status: 'ok', value }
}

function vitestReport() {
  return {
    success: true,
    testResults: REQUIRED_VITEST.map((name) => ({
      name: `${ROOT}/${name}`,
      status: 'passed',
      assertionResults: Array.from({ length: MIN_ASSERTIONS_BY_FILE[name] ?? 1 }, (_, index) => ({
        status: 'passed',
        fullName: `${name} :: fixture ${index}`
      }))
    }))
  }
}

function playwrightReport() {
  return {
    config: {},
    errors: [],
    suites: [
      {
        title: '',
        suites: REQUIRED_PLAYWRIGHT.map((file) => ({
          title: file,
          file,
          suites: [],
          specs: [
            {
              title: `${file} fixture`,
              file,
              line: 1,
              column: 1,
              tests: [
                {
                  title: `${file} fixture`,
                  projectName: 'chromium',
                  status: 'expected',
                  results: [{ status: 'passed', duration: 100 }]
                }
              ]
            }
          ]
        }))
      }
    ]
  }
}

function goldenEvidence() {
  return {
    schemaVersion: 'golden-chain/1',
    status: 'pass',
    providerMode: 'mock',
    realProvidersVerified: false,
    characterId: CHARACTER_ID,
    characterBriefVersionId: 'cbv_01J00000000000000000000000',
    projectId: PROJECT_ID,
    childProjectId: CHILD_PROJECT_ID,
    assetId: 'ast_01J00000000000000000000000',
    manualAssetId: 'ast_01J00000000000000000000001',
    promptVersionId: 'pvr_01J00000000000000000000000',
    providerConnectionId: 'conn_01J00000000000000000000000',
    generationId: 'gen_01J00000000000000000000000',
    executionJobId: 'job_01J00000000000000000000001',
    candidateId: 'gcn_01J00000000000000000000000',
    firstArtVersionId: 'arv_01J00000000000000000000000',
    secondArtVersionId: 'arv_01J00000000000000000000001',
    thirdArtVersionId: 'arv_01J00000000000000000000002',
    auxiliaryAssetId: 'ast_01J00000000000000000000002',
    referenceRevisionReason: 'add',
    referenceCount: 2,
    activeAfterRollback: 'arv_01J00000000000000000000000',
    forkId: 'frk_01J00000000000000000000000',
    forkSourceHash: 'b'.repeat(64),
    seedArtVersionId: 'arv_01J00000000000000000000003',
    seedReferenceCount: 2,
    backupId: BACKUP_ID,
    backupJobId: BACKUP_JOB_ID,
    backupArtifactPath: BACKUP_ARTIFACT_PATH,
    backupSha256: BACKUP_SHA,
    backupFileSize: BACKUP_ZIP.length,
    checks: { ...GOLDEN_CHECKS }
  }
}

function sseEvidence() {
  return {
    schemaVersion: 'sse-replay/1',
    status: 'pass',
    characterAId: 'chr_01J00000000000000000000001',
    characterBId: 'chr_01J00000000000000000000002',
    initialSeq: 10,
    after: 9,
    lastEventIdHeader: '10',
    replayedSeq: 10,
    secondSeq: 11,
    observedSeqs: [10, 11],
    checks: { ...SSE_CHECKS }
  }
}

function verificationEvidence() {
  return {
    schemaVersion: 'backup-verification/1',
    status: 'pass',
    artifact: {
      path: BACKUP_ARTIFACT_PATH,
      byteSize: BACKUP_ZIP.length,
      sha256: BACKUP_SHA,
      entryCount: 5
    },
    manifest: {
      formatVersion: 1,
      characterId: CHARACTER_ID,
      backupId: BACKUP_ID,
      schemaVersion: '0004_backups',
      entityCount: 10,
      blobCount: 1,
      blobBytes: 128
    },
    checks: { ...VERIFICATION_CHECKS },
    errors: []
  }
}

function downloadEvidence() {
  return {
    schemaVersion: 'backup-download/1',
    backupId: BACKUP_ID,
    characterId: CHARACTER_ID,
    contentType: 'application/zip',
    contentDisposition: `attachment; filename="agent2live-${CHARACTER_ID}-${BACKUP_ID}.zip"`,
    contentLength: String(BACKUP_ZIP.length),
    byteSize: BACKUP_ZIP.length,
    sha256: BACKUP_SHA
  }
}

function phase0PrerequisiteEvidence() {
  return {
    schemaVersion: 'phase0-prerequisite/1',
    status: 'pass',
    generatedAt: '2026-11-12T00:00:00.000Z',
    phase0SourceCommit: 'c'.repeat(40),
    phase05SourceCommit: 'd'.repeat(40),
    phase05Gate: 'G0.5-QUALITY',
    phase1Head: 'a'.repeat(40),
    requiredGates: ['G0-RENDER', 'G0-DATA', 'G0-DOCS'],
    checks: {
      phase0GatePresent: true,
      phase0GateValid: true,
      requiredGatesPass: true,
      requiredGateChecksPass: true,
      phase05GatePresent: true,
      phase05GateValid: true,
      phase05QualityPass: true,
      phase05Clean: true,
      phase05CommitAncestor: true,
      phase0Clean: true,
      phase0CommitAncestor: true
    }
  }
}

function pngFixture(width, height) {
  const bytes = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  bytes[24] = 8
  bytes[25] = 6
  return bytes
}

function axeEvidence() {
  return {
    schemaVersion: 'ui-axe/1',
    status: 'pass',
    generatedAt: '2026-11-12T00:00:00.000Z',
    viewport: { width: 1440, height: 900 },
    pages: UI_EVIDENCE_PAGES.map((name) => ({
      name,
      status: 'pass',
      violations: []
    })),
    visualBaselines: [...UI_VISUAL_BASELINES],
    checks: { axePassed: true }
  }
}

function tokenLintEvidence() {
  return {
    schemaVersion: 'ui-token-lint/1',
    status: 'pass',
    generatedAt: '2026-11-12T00:00:00.000Z',
    scannedFiles: 42,
    violations: [],
    rules: [...UI_TOKEN_RULES]
  }
}

function visualEvidence(width = 1440, height = 900) {
  return Object.fromEntries(
    UI_EVIDENCE_PAGES.map((name) => [name, { status: 'ok', bytes: pngFixture(width, height) }])
  )
}

function validEvidence() {
  return {
    vitest: ok(vitestReport()),
    playwright: ok(playwrightReport()),
    golden: ok(goldenEvidence()),
    sse: ok(sseEvidence()),
    phase0Prerequisite: ok(phase0PrerequisiteEvidence()),
    verification: ok(verificationEvidence()),
    download: ok(downloadEvidence()),
    backup: { status: 'ok', bytes: BACKUP_ZIP },
    axe: ok(axeEvidence()),
    tokenLint: ok(tokenLintEvidence()),
    visuals: visualEvidence()
  }
}

function validRepository() {
  return {
    available: true,
    head: 'a'.repeat(40),
    gitignoreHasPlans: true,
    plansIgnored: true,
    trackedPlans: [],
    dirty: false,
    evidenceFresh: true,
    prohibitedTracked: [],
    phase0AssetCheck: true
  }
}

function evaluate(options = {}) {
  return evaluatePhase1Gate({
    evidence: options.evidence ?? validEvidence(),
    repository: options.repository ?? validRepository(),
    root: ROOT,
    now: new Date(0)
  })
}

function mutateVitest(evidence, mutate) {
  const report = structuredClone(evidence.vitest.value)
  mutate(report)
  evidence.vitest = ok(report)
  return evidence
}

test('passes a complete mock-only gate', () => {
  const result = evaluate()
  assert.equal(result.overallStatus, 'pass')
  assert.equal(result.exitCode, 0)
  assert.equal(result.tagAllowed, true)
  assert.equal(result.mockOnly, true)
  assert.equal(result.realProvidersVerified, false)
  for (const gate of Object.keys(PHASE1_GATES)) {
    assert.equal(result.categories[gate].status, 'pass', gate)
  }
})

test('fails when any required Vitest test fails', () => {
  const evidence = validEvidence()
  mutateVitest(evidence, (report) => {
    report.success = false
    report.testResults.find((result) =>
      result.name.endsWith('packages/contracts/src/api.test.ts')
    ).assertionResults[0].status = 'failed'
  })
  const result = evaluate({ evidence })
  assert.equal(result.overallStatus, 'fail')
  assert.equal(result.exitCode, 1)
  assert.equal(result.categories['G1-CONTRACTS'].status, 'fail')
})

test('fails when any required Vitest test is skipped', () => {
  const evidence = validEvidence()
  mutateVitest(evidence, (report) => {
    report.testResults.find((result) =>
      result.name.endsWith('apps/desktop/src/renderer/studio/workbench/store.test.ts')
    ).assertionResults[0].status = 'skipped'
  })
  const result = evaluate({ evidence })
  assert.equal(result.overallStatus, 'fail')
  assert.equal(result.categories['G1-UI'].status, 'fail')
})

test('fails when a critical required test file is reduced to a smoke test', () => {
  const evidence = validEvidence()
  mutateVitest(evidence, (report) => {
    report.testResults.find((result) =>
      result.name.endsWith('packages/contracts/src/character-brief.test.ts')
    ).assertionResults = [{ status: 'passed' }]
  })
  const result = evaluate({ evidence })
  assert.equal(result.overallStatus, 'fail')
  assert.equal(result.categories['G1-CONTRACTS'].status, 'fail')
})

test('blocks when a required Vitest file is absent from the report', () => {
  const evidence = validEvidence()
  mutateVitest(evidence, (report) => {
    report.testResults = report.testResults.filter(
      (result) => !result.name.endsWith('apps/server/tests/forks.test.ts')
    )
  })
  const result = evaluate({ evidence })
  assert.equal(result.overallStatus, 'blocked')
  assert.equal(result.exitCode, 2)
  assert.equal(result.categories['G1-FORK'].status, 'blocked')
})

test('blocks when Vitest evidence is missing', () => {
  const evidence = validEvidence()
  evidence.vitest = { status: 'missing' }
  const result = evaluate({ evidence })
  assert.equal(result.overallStatus, 'blocked')
  assert.equal(result.exitCode, 2)
})

test('fails a retried Playwright test even when the final attempt passed', () => {
  const evidence = validEvidence()
  const report = structuredClone(evidence.playwright.value)
  report.suites[0].suites[0].specs[0].tests[0].results = [
    { status: 'failed', duration: 100 },
    { status: 'passed', duration: 90 }
  ]
  evidence.playwright = ok(report)
  const result = evaluate({ evidence })
  assert.equal(result.overallStatus, 'fail')
  assert.equal(result.categories['G1-UI'].status, 'fail')
})

test('fails when a Playwright result is skipped', () => {
  const evidence = validEvidence()
  const report = structuredClone(evidence.playwright.value)
  report.suites[0].suites[0].specs[0].tests[0].results = [{ status: 'skipped' }]
  evidence.playwright = ok(report)
  const result = evaluate({ evidence })
  assert.equal(result.overallStatus, 'fail')
})

test('blocks when UI axe evidence is missing', () => {
  const evidence = validEvidence()
  evidence.axe = { status: 'missing' }
  const result = evaluate({ evidence })
  assert.equal(result.overallStatus, 'blocked')
  assert.equal(result.exitCode, 2)
  assert.equal(result.categories['G1-UI'].status, 'blocked')
})

test('fails when UI token lint reports a violation', () => {
  const evidence = validEvidence()
  evidence.tokenLint = ok({
    ...tokenLintEvidence(),
    status: 'fail',
    violations: [
      {
        path: 'apps/desktop/src/renderer/studio/app.css',
        line: 12,
        rule: 'raw-color',
        text: 'color: #fffdf8;'
      }
    ]
  })
  const result = evaluate({ evidence })
  assert.equal(result.overallStatus, 'fail')
  assert.equal(result.exitCode, 1)
  assert.equal(result.categories['G1-UI'].status, 'fail')
})

test('fails when a UI visual baseline has the wrong dimensions', () => {
  const evidence = validEvidence()
  evidence.visuals = {
    ...visualEvidence(),
    overview: { status: 'ok', bytes: pngFixture(1280, 720) }
  }
  const result = evaluate({ evidence })
  assert.equal(result.overallStatus, 'fail')
  assert.equal(result.exitCode, 1)
  assert.equal(result.categories['G1-UI'].status, 'fail')
})

test('blocks when golden-chain evidence is missing', () => {
  const evidence = validEvidence()
  evidence.golden = { status: 'missing' }
  const result = evaluate({ evidence })
  assert.equal(result.overallStatus, 'blocked')
  assert.equal(result.categories['G1-GOLDEN-CHAIN'].status, 'blocked')
})

test('blocks when the Phase 0 prerequisite evidence is missing', () => {
  const evidence = validEvidence()
  evidence.phase0Prerequisite = { status: 'missing' }
  const result = evaluate({ evidence })
  assert.equal(result.overallStatus, 'blocked')
  assert.equal(result.categories['G1-GOLDEN-CHAIN'].status, 'blocked')
})

test('fails when the golden chain claims a real provider was verified', () => {
  const evidence = validEvidence()
  evidence.golden = ok({ ...goldenEvidence(), realProvidersVerified: true })
  const result = evaluate({ evidence })
  assert.equal(result.overallStatus, 'fail')
  assert.equal(result.categories['G1-GOLDEN-CHAIN'].status, 'fail')
})

test('fails when SSE replay cursor proof is inconsistent', () => {
  const evidence = validEvidence()
  evidence.sse = ok({ ...sseEvidence(), secondSeq: 10 })
  const result = evaluate({ evidence })
  assert.equal(result.overallStatus, 'fail')
  assert.equal(result.categories['G1-GOLDEN-CHAIN'].status, 'fail')
})

test('fails when backup verification does not match the artifact bytes', () => {
  const evidence = validEvidence()
  evidence.verification = ok({
    ...verificationEvidence(),
    artifact: {
      ...verificationEvidence().artifact,
      sha256: '0'.repeat(64)
    }
  })
  const result = evaluate({ evidence })
  assert.equal(result.overallStatus, 'fail')
  assert.equal(result.categories['G1-GOLDEN-CHAIN'].status, 'fail')
})

test('fails when the repository worktree is dirty', () => {
  const result = evaluate({
    repository: { ...validRepository(), dirty: true }
  })
  assert.equal(result.overallStatus, 'fail')
  assert.equal(result.exitCode, 1)
  assert.equal(result.tagAllowed, false)
})

test('fails when evidence predates the current source commit', () => {
  const result = evaluate({
    repository: { ...validRepository(), evidenceFresh: false }
  })
  assert.equal(result.overallStatus, 'fail')
  assert.equal(
    result.problems.some((problem) => problem.code === 'EVIDENCE_STALE'),
    true
  )
})

test('blocks when the repository cannot be inspected', () => {
  const result = evaluate({
    repository: { ...validRepository(), available: false, head: null }
  })
  assert.equal(result.overallStatus, 'blocked')
  assert.equal(result.exitCode, 2)
  assert.equal(result.tagAllowed, false)
})

test('lets fail dominate blocked', () => {
  const evidence = validEvidence()
  evidence.vitest = { status: 'missing' }
  evidence.golden = ok({ ...goldenEvidence(), providerMode: 'real' })
  const result = evaluate({ evidence })
  assert.equal(result.overallStatus, 'fail')
  assert.equal(result.exitCode, 1)
})

test('renders a non-secret markdown summary', () => {
  const result = evaluate()
  const markdown = renderGateMarkdown(result)
  assert.match(markdown, /Phase 1 Gate/)
  assert.match(markdown, /PASS/)
  assert.match(markdown, /G1-CONTRACTS/)
  assert.equal(markdown.includes('Bearer '), false)
  assert.equal(markdown.includes('/Users/'), false)
})

test('gateExitCode maps pass/fail/blocked without ambiguity', () => {
  assert.equal(gateExitCode({ overallStatus: 'pass' }), 0)
  assert.equal(gateExitCode({ overallStatus: 'fail' }), 1)
  assert.equal(gateExitCode({ overallStatus: 'blocked' }), 2)
})
