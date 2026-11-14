#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const GATE_SCHEMA_VERSION = 'phase1-gate/1'
export const PHASE1_EVIDENCE_DIR = 'docs/plans/evidence/phase1'
export const BACKUP_ARTIFACT_PATH = `${PHASE1_EVIDENCE_DIR}/backup/character-export.zip`
export const PHASE0_PREREQUISITE_PATH = `${PHASE1_EVIDENCE_DIR}/phase0-prerequisite.json`
export const UI_EVIDENCE_PAGES = Object.freeze([
  'overview',
  'new-character-empty',
  'new-character-full',
  'character-card',
  'workbench-references',
  'workbench-candidates',
  'providers'
])
export const UI_VISUAL_BASELINES = Object.freeze(
  UI_EVIDENCE_PAGES.map((name) => `${PHASE1_EVIDENCE_DIR}/ui/visual/${name}-1440x900.png`)
)
export const UI_TOKEN_RULES = Object.freeze(['raw-color', 'arbitrary-radius', 'deep-import'])
export const MIN_ASSERTIONS_BY_FILE = Object.freeze({
  'packages/contracts/src/art-reference.test.ts': 3,
  'packages/contracts/src/character-brief.test.ts': 3,
  'apps/server/tests/prompt-brief-projection.test.ts': 2,
  'apps/server/tests/forks.test.ts': 2,
  'e2e/golden-chain.spec.ts': 1
})

function gate(tests, playwright) {
  return Object.freeze({
    tests: Object.freeze(tests),
    playwright: Object.freeze(playwright)
  })
}

export const PHASE1_GATES = Object.freeze({
  'G1-CONTRACTS': gate(
    [
      'packages/contracts/src/api.test.ts',
      'packages/contracts/src/art-reference.test.ts',
      'packages/contracts/src/character-brief.test.ts',
      'packages/contracts/src/errors.test.ts',
      'packages/contracts/src/ids.test.ts',
      'packages/contracts/src/prompt.test.ts',
      'packages/providers/tests/mock-art.test.ts'
    ],
    []
  ),
  'G1-DATA': gate(
    [
      'apps/server/tests/migrations.test.ts',
      'apps/server/tests/events-buffer.test.ts',
      'apps/server/tests/blobs.test.ts',
      'apps/server/tests/audit.test.ts',
      'apps/server/tests/conditional.test.ts',
      'apps/server/tests/assets.test.ts',
      'apps/server/tests/characters-projects.test.ts',
      'apps/server/tests/backups.test.ts'
    ],
    []
  ),
  'G1-JOBS': gate(
    [
      'apps/server/tests/jobs.test.ts',
      'apps/server/tests/jobs-idempotency.test.ts',
      'apps/server/tests/idempotency.test.ts',
      'apps/server/tests/wiring.test.ts'
    ],
    []
  ),
  'G1-PROMPT': gate(
    [
      'apps/server/tests/prompt-compile.test.ts',
      'apps/server/tests/prompt-brief-projection.test.ts',
      'apps/server/tests/prompt-operations.test.ts',
      'apps/server/tests/prompt-drafts.test.ts',
      'apps/server/tests/prompt-reverse-parse.test.ts',
      'apps/server/tests/prompt-reverse.test.ts',
      'apps/server/tests/prompt-suggestion-parse.test.ts',
      'apps/server/tests/prompt-suggestions.test.ts'
    ],
    []
  ),
  'G1-ART': gate(
    [
      'apps/server/tests/providers.test.ts',
      'apps/server/tests/secrets-contract.test.ts',
      'apps/server/tests/secrets-vault.test.ts',
      'apps/server/tests/generation-prepare.test.ts',
      'apps/server/tests/generation.test.ts',
      'apps/server/tests/art-versions.test.ts',
      'apps/server/tests/api-json.test.ts',
      'apps/server/tests/http-errors.test.ts',
      'packages/providers/tests/mock.test.ts',
      'packages/providers/tests/seedream.test.ts'
    ],
    []
  ),
  'G1-FORK': gate(['apps/server/tests/forks.test.ts'], []),
  'G1-UI': gate(
    [
      'packages/design-system/tests/button.test.tsx',
      'packages/design-system/tests/forms.test.tsx',
      'packages/design-system/tests/feedback.test.tsx',
      'packages/design-system/tests/layout.test.tsx',
      'packages/design-system/tests/overlays.test.tsx',
      'packages/design-system/tests/navigation.test.tsx',
      'packages/design-system/tests/data-display.test.tsx',
      'packages/design-system/tests/patterns.test.tsx',
      'packages/design-system/tests/tokens.test.tsx',
      'packages/design-system/tests/token-lint.test.ts',
      'apps/desktop/src/renderer/shared/http/client.test.ts',
      'apps/desktop/src/renderer/studio/api/invalidation.test.ts',
      'apps/desktop/src/renderer/studio/api/sse.test.ts',
      'apps/desktop/src/renderer/studio/project-progress.test.ts',
      'apps/desktop/src/renderer/studio/providers/create-flow.test.ts',
      'apps/desktop/src/renderer/studio/providers/presets.test.ts',
      'apps/desktop/src/renderer/studio/workbench/prompt-helpers.test.ts',
      'apps/desktop/src/renderer/studio/workbench/store.test.ts'
    ],
    [
      'e2e/studio-shell.spec.ts',
      'e2e/workbench.spec.ts',
      'e2e/providers.spec.ts',
      'e2e/live2d-placeholder.spec.ts',
      'e2e/ui-evidence.spec.ts'
    ]
  ),
  'G1-GOLDEN-CHAIN': gate(
    [],
    [
      'e2e/electron-shell.spec.ts',
      'e2e/live2d-render.spec.ts',
      'e2e/packaged-data.spec.ts',
      'e2e/golden-chain.spec.ts',
      'e2e/sse-replay.spec.ts'
    ]
  )
})

const REQUIRED_VITEST_FILES = Object.freeze([
  ...new Set(Object.values(PHASE1_GATES).flatMap((entry) => entry.tests))
])
const REQUIRED_PLAYWRIGHT_FILES = Object.freeze([
  ...new Set(Object.values(PHASE1_GATES).flatMap((entry) => entry.playwright))
])
const REQUIRED_PLAYWRIGHT_SET = new Set(REQUIRED_PLAYWRIGHT_FILES)
const CATEGORY_NAMES = Object.freeze(Object.keys(PHASE1_GATES))
const STATUS_RANK = Object.freeze({ pass: 0, blocked: 1, fail: 2 })

const GOLDEN_REQUIRED_STRINGS = Object.freeze([
  'characterId',
  'characterBriefVersionId',
  'projectId',
  'childProjectId',
  'assetId',
  'manualAssetId',
  'promptVersionId',
  'providerConnectionId',
  'generationId',
  'generationJobId',
  'candidateId',
  'firstArtVersionId',
  'secondArtVersionId',
  'thirdArtVersionId',
  'auxiliaryAssetId',
  'activeAfterRollback',
  'forkId',
  'forkSourceHash',
  'seedArtVersionId',
  'backupId',
  'backupJobId'
])
const GOLDEN_CHECK_NAMES = Object.freeze([
  'uiCharacterAndProjectCreated',
  'characterBriefCreated',
  'promptInputsIngested',
  'draftSavedAndCommitted',
  'mockProviderCreated',
  'generationSucceeded',
  'candidateAccepted',
  'manualVersionCreated',
  'referenceRevisionCreated',
  'rollbackActivated',
  'artVersionForked',
  'forkCopiedOrderedReferences',
  'backupCompleted',
  'backupDownloadVerified',
  'cockpitVerified',
  'workbenchVerified'
])
const SSE_CHECK_NAMES = Object.freeze([
  'replayedByQueryCursor',
  'replayedPayloadMatches',
  'secondEventIsNewer',
  'seqStrictlyIncreasing'
])
const VERIFICATION_CHECK_NAMES = Object.freeze([
  'zipStructure',
  'entrySetExact',
  'checksumsValid',
  'manifestValid',
  'schemaValid',
  'entitiesValid',
  'blobFilesValid',
  'textSafe'
])

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value, maxLength = 512) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    !value.includes('\u0000')
  )
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function worstStatus(left, right) {
  return STATUS_RANK[right] > STATUS_RANK[left] ? right : left
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function exactBooleanChecks(value, requiredNames) {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== requiredNames.length) return false
  return requiredNames.every((name) => value[name] === true)
}

function normalizeReportPath(rawPath, root) {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') return null
  let candidate = rawPath.trim()
  if (candidate.startsWith('file://')) {
    try {
      candidate = fileURLToPath(candidate)
    } catch {
      return null
    }
  }
  candidate = candidate.replaceAll('\\', '/')
  const absolute = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate)
  const relativePath = relative(root, absolute)
  if (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  ) {
    return relativePath.split(sep).join('/')
  }
  return candidate.replace(/^\.\//, '')
}

function summarizeVitest(evidence, root) {
  if (!evidence || evidence.status === 'missing') {
    return { state: 'missing' }
  }
  if (evidence.status !== 'ok') {
    return { state: 'malformed' }
  }
  const report = evidence.value
  if (!isPlainObject(report) || !Array.isArray(report.testResults)) {
    return { state: 'malformed' }
  }
  if (report.testResults.length === 0) {
    return { state: 'empty' }
  }

  const files = new Map()
  let totalTests = 0
  let failedTests = 0
  let skippedTests = 0

  for (const result of report.testResults) {
    if (!isPlainObject(result)) return { state: 'malformed' }
    const file = normalizeReportPath(result.name, root)
    if (!file) return { state: 'malformed' }
    if (!Array.isArray(result.assertionResults)) return { state: 'malformed' }
    const entry = files.get(file) ?? {
      assertionCount: 0,
      nonPassed: []
    }
    if (result.status === 'failed') {
      entry.nonPassed.push('result-failed')
      failedTests += 1
    }
    for (const assertion of result.assertionResults) {
      if (!isPlainObject(assertion)) return { state: 'malformed' }
      entry.assertionCount += 1
      totalTests += 1
      if (assertion.status === 'failed') {
        entry.nonPassed.push('failed')
        failedTests += 1
      } else if (assertion.status !== 'passed') {
        entry.nonPassed.push('non-passing')
        skippedTests += 1
      }
    }
    files.set(file, entry)
  }

  if (totalTests === 0) return { state: 'empty' }

  return {
    state: 'ok',
    files,
    totalTests,
    failedTests,
    skippedTests,
    reportFailed: report.success === false
  }
}

function summarizePlaywright(evidence, root) {
  if (!evidence || evidence.status === 'missing') {
    return { state: 'missing' }
  }
  if (evidence.status !== 'ok') {
    return { state: 'malformed' }
  }
  const report = evidence.value
  if (!isPlainObject(report) || !Array.isArray(report.suites)) {
    return { state: 'malformed' }
  }
  if (report.errors !== undefined && !Array.isArray(report.errors)) {
    return { state: 'malformed' }
  }

  const files = new Map()
  let totalTests = 0
  let badTests = 0
  let retryTests = 0

  const walk = (suites, inheritedFile) => {
    if (!Array.isArray(suites)) return false
    for (const suite of suites) {
      if (!isPlainObject(suite)) return false
      const suiteFile = typeof suite.file === 'string' ? suite.file : inheritedFile
      if (suite.specs !== undefined && !Array.isArray(suite.specs)) return false
      for (const spec of suite.specs ?? []) {
        if (!isPlainObject(spec)) return false
        const file = normalizeReportPath(typeof spec.file === 'string' ? spec.file : suiteFile, root)
        if (!file) return false
        if (!Array.isArray(spec.tests)) return false
        const entry = files.get(file) ?? { testCount: 0, badTests: 0 }
        for (const playwrightTest of spec.tests) {
          if (!isPlainObject(playwrightTest)) return false
          entry.testCount += 1
          totalTests += 1
          const results = Array.isArray(playwrightTest.results) ? playwrightTest.results : []
          let badReason = null
          if (results.length === 0) {
            badReason = 'no-results'
          } else if (results.length > 1) {
            badReason = 'retried'
            retryTests += 1
          } else if (!isPlainObject(results[0]) || results[0].status !== 'passed') {
            badReason = 'non-passing'
          } else if (playwrightTest.status === 'skipped') {
            badReason = 'skipped'
          }
          if (badReason !== null) {
            entry.badTests += 1
            badTests += 1
          }
        }
        files.set(file, entry)
      }
      if (!walk(suite.suites ?? [], suiteFile)) return false
    }
    return true
  }

  if (!walk(report.suites, null)) return { state: 'malformed' }
  if (totalTests === 0) return { state: 'empty' }

  return {
    state: 'ok',
    files,
    totalTests,
    badTests,
    retryTests,
    errorsCount: Array.isArray(report.errors) ? report.errors.length : 0
  }
}

function validateGoldenEvidence(golden, artifactMeta) {
  const issues = []
  if (!isPlainObject(golden)) return ['golden evidence is not an object']
  if (golden.schemaVersion !== 'golden-chain/1') {
    issues.push('schemaVersion must be golden-chain/1')
  }
  if (golden.status !== 'pass') issues.push('status must be pass')
  if (golden.providerMode !== 'mock') issues.push('providerMode must be mock')
  if (golden.realProvidersVerified !== false) {
    issues.push('realProvidersVerified must be false')
  }
  for (const field of GOLDEN_REQUIRED_STRINGS) {
    if (!isNonEmptyString(golden[field])) issues.push(`${field} must be a non-empty string`)
  }
  if (golden.projectId === golden.childProjectId) {
    issues.push('parent and child project IDs must differ')
  }
  if (golden.firstArtVersionId === golden.secondArtVersionId) {
    issues.push('first and second art version IDs must differ')
  }
  if (
    golden.thirdArtVersionId === golden.firstArtVersionId ||
    golden.thirdArtVersionId === golden.secondArtVersionId
  ) {
    issues.push('third art version ID must differ from the first two snapshots')
  }
  if (golden.activeAfterRollback !== golden.firstArtVersionId) {
    issues.push('activeAfterRollback must point at the first art version')
  }
  if (golden.assetId === golden.manualAssetId) {
    issues.push('generated and manual asset IDs must differ')
  }
  if (golden.auxiliaryAssetId === golden.assetId || golden.auxiliaryAssetId === golden.manualAssetId) {
    issues.push('auxiliary asset ID must differ from the generated and manual assets')
  }
  if (golden.referenceRevisionReason !== 'add') {
    issues.push('referenceRevisionReason must be add')
  }
  if (!isPositiveInteger(golden.referenceCount) || golden.referenceCount < 2) {
    issues.push('referenceCount must be an integer of at least 2')
  }
  if (!isPositiveInteger(golden.seedReferenceCount) || golden.seedReferenceCount !== golden.referenceCount) {
    issues.push('seedReferenceCount must equal referenceCount')
  }
  if (!isSha256(golden.forkSourceHash)) {
    issues.push('forkSourceHash must be a lowercase SHA-256')
  }
  if (golden.backupArtifactPath !== BACKUP_ARTIFACT_PATH) {
    issues.push('backupArtifactPath must use the fixed Phase 1 evidence path')
  }
  if (!isSha256(golden.backupSha256)) issues.push('backupSha256 must be a lowercase SHA-256')
  if (!isPositiveInteger(golden.backupFileSize)) {
    issues.push('backupFileSize must be a positive integer')
  }
  if (!exactBooleanChecks(golden.checks, GOLDEN_CHECK_NAMES)) {
    issues.push('golden checks must contain exactly the required passing booleans')
  }
  if (artifactMeta !== null) {
    if (golden.backupFileSize !== artifactMeta.byteSize) {
      issues.push('golden backupFileSize does not match the artifact')
    }
    if (golden.backupSha256 !== artifactMeta.sha256) {
      issues.push('golden backupSha256 does not match the artifact')
    }
  }
  return issues
}

function validateSseEvidence(sse) {
  const issues = []
  if (!isPlainObject(sse)) return ['SSE evidence is not an object']
  if (sse.schemaVersion !== 'sse-replay/1') {
    issues.push('schemaVersion must be sse-replay/1')
  }
  if (sse.status !== 'pass') issues.push('status must be pass')
  if (!isNonEmptyString(sse.characterAId) || !isNonEmptyString(sse.characterBId)) {
    issues.push('both SSE character IDs must be non-empty strings')
  }
  if (sse.characterAId === sse.characterBId) {
    issues.push('SSE character IDs must differ')
  }
  if (!isPositiveInteger(sse.initialSeq)) issues.push('initialSeq must be positive')
  if (sse.after !== sse.initialSeq - 1) {
    issues.push('after must be exactly initialSeq - 1')
  }
  if (sse.lastEventIdHeader !== String(sse.initialSeq)) {
    issues.push('lastEventIdHeader must conflict with the after cursor')
  }
  if (sse.replayedSeq !== sse.initialSeq) {
    issues.push('replayedSeq must equal initialSeq')
  }
  if (!isPositiveInteger(sse.secondSeq) || sse.secondSeq <= sse.replayedSeq) {
    issues.push('secondSeq must be greater than replayedSeq')
  }
  if (!Array.isArray(sse.observedSeqs) || sse.observedSeqs.length < 2) {
    issues.push('observedSeqs must contain at least two sequence numbers')
  } else {
    if (!sse.observedSeqs.every(isPositiveInteger)) {
      issues.push('observedSeqs must contain positive integers only')
    } else {
      const strictlyIncreasing = sse.observedSeqs.every(
        (value, index) => index === 0 || value > sse.observedSeqs[index - 1]
      )
      if (!strictlyIncreasing) issues.push('observedSeqs must be strictly increasing')
      if (sse.observedSeqs[0] !== sse.initialSeq) {
        issues.push('observedSeqs must start at initialSeq')
      }
      if (!sse.observedSeqs.includes(sse.secondSeq)) {
        issues.push('observedSeqs must include secondSeq')
      }
    }
  }
  if (!exactBooleanChecks(sse.checks, SSE_CHECK_NAMES)) {
    issues.push('SSE checks must contain exactly the required passing booleans')
  }
  return issues
}

function validateVerificationEvidence(verification, artifactMeta, golden) {
  const issues = []
  if (!isPlainObject(verification)) return ['verification evidence is not an object']
  if (verification.schemaVersion !== 'backup-verification/1') {
    issues.push('schemaVersion must be backup-verification/1')
  }
  if (verification.status !== 'pass') issues.push('status must be pass')
  if (!Array.isArray(verification.errors) || verification.errors.length !== 0) {
    issues.push('errors must be an empty array')
  }
  if (!exactBooleanChecks(verification.checks, VERIFICATION_CHECK_NAMES)) {
    issues.push('verification checks must contain exactly the required passing booleans')
  }
  const artifact = verification.artifact
  if (!isPlainObject(artifact)) {
    issues.push('artifact must be an object')
  } else {
    if (artifact.path !== BACKUP_ARTIFACT_PATH) {
      issues.push('artifact.path must use the fixed Phase 1 evidence path')
    }
    if (!isPositiveInteger(artifact.byteSize)) {
      issues.push('artifact.byteSize must be positive')
    }
    if (!isSha256(artifact.sha256)) {
      issues.push('artifact.sha256 must be a lowercase SHA-256')
    }
    if (!isPositiveInteger(artifact.entryCount)) {
      issues.push('artifact.entryCount must be positive')
    }
    if (artifactMeta !== null) {
      if (artifact.byteSize !== artifactMeta.byteSize) {
        issues.push('verification byteSize does not match the artifact')
      }
      if (artifact.sha256 !== artifactMeta.sha256) {
        issues.push('verification SHA-256 does not match the artifact')
      }
    }
  }
  const manifest = verification.manifest
  if (!isPlainObject(manifest)) {
    issues.push('manifest must be an object')
  } else {
    if (manifest.formatVersion !== 1) issues.push('manifest formatVersion must be 1')
    if (!isNonEmptyString(manifest.characterId)) {
      issues.push('manifest characterId must be a non-empty string')
    }
    if (!isNonEmptyString(manifest.backupId)) {
      issues.push('manifest backupId must be a non-empty string')
    }
    if (!isNonEmptyString(manifest.schemaVersion)) {
      issues.push('manifest schemaVersion must be a non-empty string')
    }
    if (!isNonNegativeInteger(manifest.entityCount)) {
      issues.push('manifest entityCount must be a non-negative integer')
    }
    if (!isNonNegativeInteger(manifest.blobCount)) {
      issues.push('manifest blobCount must be a non-negative integer')
    }
    if (!isNonNegativeInteger(manifest.blobBytes)) {
      issues.push('manifest blobBytes must be a non-negative integer')
    }
    if (golden) {
      if (manifest.characterId !== golden.characterId) {
        issues.push('manifest characterId does not match golden evidence')
      }
      if (manifest.backupId !== golden.backupId) {
        issues.push('manifest backupId does not match golden evidence')
      }
    }
  }
  if (golden && artifactMeta !== null) {
    if (golden.backupFileSize !== artifactMeta.byteSize) {
      issues.push('golden backupFileSize does not match the verified artifact')
    }
    if (golden.backupSha256 !== artifactMeta.sha256) {
      issues.push('golden backupSha256 does not match the verified artifact')
    }
  }
  return issues
}

function validateDownloadEvidence(download, artifactMeta, golden) {
  const issues = []
  if (!isPlainObject(download)) return ['download evidence is not an object']
  if (download.schemaVersion !== 'backup-download/1') {
    issues.push('schemaVersion must be backup-download/1')
  }
  if (!isNonEmptyString(download.backupId)) {
    issues.push('backupId must be a non-empty string')
  }
  if (!isNonEmptyString(download.characterId)) {
    issues.push('characterId must be a non-empty string')
  }
  if (
    typeof download.contentType !== 'string' ||
    !download.contentType.toLowerCase().includes('application/zip')
  ) {
    issues.push('contentType must contain application/zip')
  }
  if (typeof download.contentDisposition !== 'string') {
    issues.push('contentDisposition must be a string')
  }
  if (!isPositiveInteger(download.byteSize)) {
    issues.push('byteSize must be positive')
  }
  if (download.contentLength !== String(download.byteSize)) {
    issues.push('contentLength must equal byteSize as a decimal string')
  }
  if (!isSha256(download.sha256)) {
    issues.push('sha256 must be a lowercase SHA-256')
  }
  if (golden) {
    if (download.backupId !== golden.backupId) {
      issues.push('download backupId does not match golden evidence')
    }
    if (download.characterId !== golden.characterId) {
      issues.push('download characterId does not match golden evidence')
    }
    const expectedDisposition = `attachment; filename="agent2live-${golden.characterId}-${golden.backupId}.zip"`
    if (download.contentDisposition !== expectedDisposition) {
      issues.push('contentDisposition does not match the golden backup')
    }
    if (download.byteSize !== golden.backupFileSize) {
      issues.push('download byteSize does not match golden evidence')
    }
    if (download.sha256 !== golden.backupSha256) {
      issues.push('download SHA-256 does not match golden evidence')
    }
  }
  if (artifactMeta !== null) {
    if (download.byteSize !== artifactMeta.byteSize) {
      issues.push('download byteSize does not match the artifact')
    }
    if (download.sha256 !== artifactMeta.sha256) {
      issues.push('download SHA-256 does not match the artifact')
    }
  }
  return issues
}

function validateAxeEvidence(axe) {
  const issues = []
  if (!isPlainObject(axe)) return ['UI axe evidence is not an object']
  if (axe.schemaVersion !== 'ui-axe/1') issues.push('schemaVersion must be ui-axe/1')
  if (axe.status !== 'pass') issues.push('status must be pass')
  if (!isNonEmptyString(axe.generatedAt)) {
    issues.push('generatedAt must be a non-empty string')
  }
  if (!isPlainObject(axe.viewport) || axe.viewport.width !== 1440 || axe.viewport.height !== 900) {
    issues.push('viewport must be exactly 1440x900')
  }
  if (!Array.isArray(axe.pages)) {
    issues.push('pages must be an array')
  } else {
    if (axe.pages.length !== UI_EVIDENCE_PAGES.length) {
      issues.push(`pages must contain exactly ${UI_EVIDENCE_PAGES.length} entries`)
    }
    const names = []
    for (const page of axe.pages) {
      if (!isPlainObject(page)) {
        issues.push('each axe page must be an object')
        continue
      }
      if (!isNonEmptyString(page.name)) {
        issues.push('each axe page name must be a non-empty string')
        continue
      }
      names.push(page.name)
      if (page.status !== 'pass') issues.push(`axe page ${page.name} must pass`)
      if (!Array.isArray(page.violations) || page.violations.length !== 0) {
        issues.push(`axe page ${page.name} must report zero violations`)
      }
    }
    const uniqueNames = new Set(names)
    if (uniqueNames.size !== names.length) {
      issues.push('axe page names must be unique')
    }
    for (const expected of UI_EVIDENCE_PAGES) {
      if (!uniqueNames.has(expected)) {
        issues.push(`axe page ${expected} is missing`)
      }
    }
  }
  if (!Array.isArray(axe.visualBaselines)) {
    issues.push('visualBaselines must be an array')
  } else {
    const actual = axe.visualBaselines
    if (
      actual.length !== UI_VISUAL_BASELINES.length ||
      actual.some((baseline) => !UI_VISUAL_BASELINES.includes(baseline))
    ) {
      issues.push('visualBaselines must list exactly the seven fixed 1440x900 screenshots')
    }
    if (new Set(actual).size !== actual.length) {
      issues.push('visualBaselines must not contain duplicates')
    }
  }
  if (!exactBooleanChecks(axe.checks, ['axePassed'])) {
    issues.push('axe checks must contain exactly axePassed: true')
  }
  return issues
}

function validateTokenLintEvidence(tokenLint) {
  const issues = []
  if (!isPlainObject(tokenLint)) return ['UI token lint evidence is not an object']
  if (tokenLint.schemaVersion !== 'ui-token-lint/1') {
    issues.push('schemaVersion must be ui-token-lint/1')
  }
  if (tokenLint.status !== 'pass') issues.push('status must be pass')
  if (!isNonEmptyString(tokenLint.generatedAt)) {
    issues.push('generatedAt must be a non-empty string')
  }
  if (!isPositiveInteger(tokenLint.scannedFiles)) {
    issues.push('scannedFiles must be positive')
  }
  if (!Array.isArray(tokenLint.violations) || tokenLint.violations.length !== 0) {
    issues.push('violations must be an empty array')
  }
  if (
    !Array.isArray(tokenLint.rules) ||
    tokenLint.rules.length !== UI_TOKEN_RULES.length ||
    UI_TOKEN_RULES.some((rule) => !tokenLint.rules.includes(rule))
  ) {
    issues.push('rules must include raw-color, arbitrary-radius, and deep-import')
  }
  return issues
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function pngDimensions(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 33) return null
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return null
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  }
}

function validateVisualEvidence(name, bytes) {
  const dimensions = pngDimensions(bytes)
  if (dimensions === null) {
    return [`${name} is not a PNG with a readable IHDR header`]
  }
  if (dimensions.width !== 1440 || dimensions.height !== 900) {
    return [`${name} must be 1440x900, got ${dimensions.width}x${dimensions.height}`]
  }
  return []
}

function loadJsonEvidence(filePath) {
  if (!existsSync(filePath)) return { status: 'missing' }
  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) return { status: 'malformed' }
    return { status: 'ok', value: JSON.parse(readFileSync(filePath, 'utf8')) }
  } catch {
    return { status: 'malformed' }
  }
}

function loadBytesEvidence(filePath) {
  if (!existsSync(filePath)) return { status: 'missing' }
  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) return { status: 'malformed' }
    return { status: 'ok', bytes: readFileSync(filePath) }
  } catch {
    return { status: 'malformed' }
  }
}

function publicVitestSummary(summary) {
  if (summary.state !== 'ok') {
    return {
      status: summary.state,
      requiredFiles: REQUIRED_VITEST_FILES.length,
      reportedFiles: 0,
      totalTests: 0,
      failedTests: 0,
      skippedTests: 0
    }
  }
  return {
    status: 'ok',
    requiredFiles: REQUIRED_VITEST_FILES.length,
    reportedFiles: summary.files.size,
    totalTests: summary.totalTests,
    failedTests: summary.failedTests,
    skippedTests: summary.skippedTests
  }
}

function publicPlaywrightSummary(summary) {
  if (summary.state !== 'ok') {
    return {
      status: summary.state,
      requiredSpecs: REQUIRED_PLAYWRIGHT_FILES.length,
      reportedSpecs: 0,
      unexpectedSpecs: 0,
      totalTests: 0,
      badTests: 0,
      retryTests: 0,
      reportErrors: 0
    }
  }
  const unexpectedSpecs = [...summary.files.keys()].filter(
    (file) => !REQUIRED_PLAYWRIGHT_SET.has(file)
  ).length
  return {
    status: 'ok',
    requiredSpecs: REQUIRED_PLAYWRIGHT_FILES.length,
    reportedSpecs: summary.files.size,
    unexpectedSpecs,
    totalTests: summary.totalTests,
    badTests: summary.badTests,
    retryTests: summary.retryTests,
    reportErrors: summary.errorsCount
  }
}

function validatePhase0Prerequisite(value, repository) {
  const issues = []
  if (!isPlainObject(value)) return ['Phase 0 prerequisite evidence is not an object']
  if (value.schemaVersion !== 'phase0-prerequisite/1') {
    issues.push('schemaVersion must be phase0-prerequisite/1')
  }
  if (value.status !== 'pass') issues.push('status must be pass')
  if (
    !exactBooleanChecks(value.checks, [
      'phase0GatePresent',
      'phase0GateValid',
      'requiredGatesPass',
      'requiredGateChecksPass',
      'phase05GatePresent',
      'phase05GateValid',
      'phase05QualityPass',
      'phase05Clean',
      'phase05CommitAncestor',
      'phase0Clean',
      'phase0CommitAncestor'
    ])
  ) {
    issues.push('all Phase 0 prerequisite checks must be exactly true')
  }
  if (
    !Array.isArray(value.requiredGates) ||
    ['G0-RENDER', 'G0-DATA', 'G0-DOCS'].some((gate) => !value.requiredGates.includes(gate))
  ) {
    issues.push('requiredGates must include G0-RENDER, G0-DATA, and G0-DOCS')
  }
  if (value.phase05Gate !== 'G0.5-QUALITY') {
    issues.push('phase05Gate must be G0.5-QUALITY')
  }
  if (
    !isSha256(value.phase05SourceCommit ?? '') &&
    !/^[0-9a-f]{40,64}$/.test(value.phase05SourceCommit ?? '')
  ) {
    issues.push('phase05SourceCommit must be a git object id')
  }
  if (
    !isSha256(value.phase0SourceCommit ?? '') &&
    !/^[0-9a-f]{40,64}$/.test(value.phase0SourceCommit ?? '')
  ) {
    issues.push('phase0SourceCommit must be a git object id')
  }
  // Head equality can only be judged against an inspectable repository; when the
  // repository is unavailable the mismatch is already reported as blocked, and a
  // fail here would wrongly dominate that blocked result.
  if (
    isPlainObject(repository) &&
    repository.available === true &&
    (!isNonEmptyString(repository.head, 64) || value.phase1Head !== repository.head)
  ) {
    issues.push('phase1Head must equal the current repository HEAD')
  }
  return issues
}

export function evaluatePhase1Gate({ evidence, repository, root = process.cwd(), now = new Date() }) {
  const problems = []
  const categories = Object.fromEntries(
    CATEGORY_NAMES.map((name) => [
      name,
      {
        status: 'pass',
        tests: [...PHASE1_GATES[name].tests],
        playwright: [...PHASE1_GATES[name].playwright],
        problems: []
      }
    ])
  )
  let artifactMeta = null

  const addProblem = (gateName, severity, code, message) => {
    const problem = { gate: gateName, severity, code, message }
    problems.push(problem)
    if (gateName !== null) {
      const category = categories[gateName]
      category.status = worstStatus(category.status, severity)
      category.problems.push(problem)
    }
  }

  const mark = (gateName, severity, code, message) => addProblem(gateName, severity, code, message)

  const markGlobal = (severity, code, message) => addProblem(null, severity, code, message)

  const requireJsonEvidence = (key, label) => {
    const entry = evidence?.[key]
    if (!entry || entry.status === 'missing') {
      mark(
        'G1-GOLDEN-CHAIN',
        'blocked',
        `${key.toUpperCase()}_EVIDENCE_MISSING`,
        `${label} evidence is missing`
      )
      return null
    }
    if (entry.status !== 'ok') {
      mark(
        'G1-GOLDEN-CHAIN',
        'fail',
        `${key.toUpperCase()}_EVIDENCE_MALFORMED`,
        `${label} evidence is malformed`
      )
      return null
    }
    return entry.value
  }

  const backupEntry = evidence?.backup
  if (!backupEntry || backupEntry.status === 'missing') {
    mark('G1-GOLDEN-CHAIN', 'blocked', 'BACKUP_ARTIFACT_MISSING', 'backup ZIP artifact is missing')
  } else if (backupEntry.status !== 'ok' || !Buffer.isBuffer(backupEntry.bytes)) {
    mark('G1-GOLDEN-CHAIN', 'fail', 'BACKUP_ARTIFACT_MALFORMED', 'backup ZIP artifact is not readable bytes')
  } else {
    artifactMeta = {
      byteSize: backupEntry.bytes.length,
      sha256: sha256Hex(backupEntry.bytes)
    }
  }

  const vitest = summarizeVitest(evidence?.vitest, root)
  if (vitest.state === 'ok') {
    if (vitest.reportFailed) {
      markGlobal('fail', 'VITEST_REPORT_FAILED', 'Vitest report success is false')
    }
    if (vitest.failedTests > 0) {
      markGlobal(
        'fail',
        'VITEST_FAILED_TESTS',
        `Vitest report contains ${vitest.failedTests} failed test result(s)`
      )
    }
    if (vitest.skippedTests > 0) {
      markGlobal(
        'fail',
        'VITEST_NON_PASSING_TESTS',
        `Vitest report contains ${vitest.skippedTests} skipped or non-passing test(s)`
      )
    }
  }

  const playwright = summarizePlaywright(evidence?.playwright, root)
  if (playwright.state === 'ok') {
    if (playwright.errorsCount > 0) {
      markGlobal(
        'fail',
        'PLAYWRIGHT_REPORT_ERRORS',
        `Playwright report contains ${playwright.errorsCount} reporter error(s)`
      )
    }
    const unexpectedSpecs = [...playwright.files.keys()].filter((file) => !REQUIRED_PLAYWRIGHT_SET.has(file))
    if (unexpectedSpecs.length > 0) {
      markGlobal(
        'fail',
        'PLAYWRIGHT_UNEXPECTED_SPEC',
        `Playwright report contains ${unexpectedSpecs.length} spec file(s) outside the Phase 1 suite`
      )
    }
  }

  for (const gateName of CATEGORY_NAMES) {
    const definition = PHASE1_GATES[gateName]
    if (definition.tests.length > 0) {
      if (vitest.state === 'missing') {
        mark(gateName, 'blocked', 'VITEST_EVIDENCE_MISSING', 'Vitest JSON report is missing')
      } else if (vitest.state === 'malformed') {
        mark(gateName, 'fail', 'VITEST_EVIDENCE_MALFORMED', 'Vitest JSON report is malformed')
      } else if (vitest.state === 'empty') {
        mark(gateName, 'fail', 'VITEST_EVIDENCE_EMPTY', 'Vitest JSON report contains no tests')
      } else {
        for (const requiredFile of definition.tests) {
          const file = vitest.files.get(requiredFile)
          if (!file) {
            mark(
              gateName,
              'blocked',
              'REQUIRED_TEST_FILE_MISSING',
              `${requiredFile} is absent from the Vitest report`
            )
          } else if (file.assertionCount < (MIN_ASSERTIONS_BY_FILE[requiredFile] ?? 1)) {
            mark(
              gateName,
              'fail',
              'REQUIRED_TEST_FILE_TOO_SMALL',
              `${requiredFile} has fewer than ${MIN_ASSERTIONS_BY_FILE[requiredFile] ?? 1} test assertions`
            )
          } else if (file.nonPassed.length > 0) {
            mark(
              gateName,
              'fail',
              'REQUIRED_TEST_NOT_PASSING',
              `${requiredFile} has failed, skipped, pending, or otherwise non-passing tests`
            )
          }
        }
      }
    }

    if (definition.playwright.length > 0) {
      if (playwright.state === 'missing') {
        mark(gateName, 'blocked', 'PLAYWRIGHT_EVIDENCE_MISSING', 'Playwright JSON report is missing')
      } else if (playwright.state === 'malformed') {
        mark(gateName, 'fail', 'PLAYWRIGHT_EVIDENCE_MALFORMED', 'Playwright JSON report is malformed')
      } else if (playwright.state === 'empty') {
        mark(gateName, 'fail', 'PLAYWRIGHT_EVIDENCE_EMPTY', 'Playwright JSON report contains no tests')
      } else {
        for (const requiredSpec of definition.playwright) {
          const spec = playwright.files.get(requiredSpec)
          if (!spec) {
            mark(
              gateName,
              'blocked',
              'REQUIRED_SPEC_MISSING',
              `${requiredSpec} is absent from the Playwright report`
            )
          } else if (spec.testCount === 0) {
            mark(gateName, 'fail', 'REQUIRED_SPEC_EMPTY', `${requiredSpec} contains no tests`)
          } else if (spec.badTests > 0) {
            mark(
              gateName,
              'fail',
              'REQUIRED_SPEC_NOT_PASSING',
              `${requiredSpec} contains failed, skipped, or retried tests`
            )
          }
        }
      }
    }
  }

  const requireUiJsonEvidence = (key, codePrefix, label) => {
    const entry = evidence?.[key]
    if (!entry || entry.status === 'missing') {
      mark('G1-UI', 'blocked', `${codePrefix}_EVIDENCE_MISSING`, `${label} evidence is missing`)
      return null
    }
    if (entry.status !== 'ok') {
      mark('G1-UI', 'fail', `${codePrefix}_EVIDENCE_MALFORMED`, `${label} evidence is malformed`)
      return null
    }
    return entry.value
  }

  const axe = requireUiJsonEvidence('axe', 'UI_AXE', 'UI axe')
  const uiTokenLint = requireUiJsonEvidence('tokenLint', 'UI_TOKEN_LINT', 'UI token lint')
  let uiVisualCount = 0
  for (const name of UI_EVIDENCE_PAGES) {
    const entry = evidence?.visuals?.[name]
    if (!entry || entry.status === 'missing') {
      mark('G1-UI', 'blocked', 'UI_VISUAL_MISSING', `${name} 1440x900 visual baseline is missing`)
      continue
    }
    if (entry.status !== 'ok' || !Buffer.isBuffer(entry.bytes)) {
      mark('G1-UI', 'fail', 'UI_VISUAL_MALFORMED', `${name} 1440x900 visual baseline is not readable bytes`)
      continue
    }
    const visualIssues = validateVisualEvidence(name, entry.bytes)
    if (visualIssues.length === 0) {
      uiVisualCount += 1
    } else {
      for (const issue of visualIssues) {
        mark('G1-UI', 'fail', 'UI_VISUAL_INVALID', issue)
      }
    }
  }
  if (axe !== null) {
    for (const issue of validateAxeEvidence(axe)) {
      mark('G1-UI', 'fail', 'UI_AXE_INVALID', issue)
    }
  }
  if (uiTokenLint !== null) {
    for (const issue of validateTokenLintEvidence(uiTokenLint)) {
      mark('G1-UI', 'fail', 'UI_TOKEN_LINT_INVALID', issue)
    }
  }

  const golden = requireJsonEvidence('golden', 'golden-chain')
  const sse = requireJsonEvidence('sse', 'SSE replay')
  const verification = requireJsonEvidence('verification', 'backup verification')
  const download = requireJsonEvidence('download', 'backup download')
  const phase0Prerequisite = requireJsonEvidence('phase0Prerequisite', 'Phase 0 prerequisite')

  if (phase0Prerequisite !== null) {
    if (phase0Prerequisite.status === 'blocked') {
      mark(
        'G1-GOLDEN-CHAIN',
        'blocked',
        'PHASE0_PREREQUISITE_BLOCKED',
        'Phase 0 and Phase 0.5 quality gates must pass before Phase 1'
      )
    } else {
      for (const issue of validatePhase0Prerequisite(phase0Prerequisite, repository)) {
        mark('G1-GOLDEN-CHAIN', 'fail', 'PHASE0_PREREQUISITE_INVALID', issue)
      }
    }
  }
  if (golden !== null) {
    for (const issue of validateGoldenEvidence(golden, artifactMeta)) {
      mark('G1-GOLDEN-CHAIN', 'fail', 'GOLDEN_CHAIN_INVALID', issue)
    }
  }
  if (sse !== null) {
    for (const issue of validateSseEvidence(sse)) {
      mark('G1-GOLDEN-CHAIN', 'fail', 'SSE_REPLAY_INVALID', issue)
    }
  }
  if (verification !== null) {
    for (const issue of validateVerificationEvidence(
      verification,
      artifactMeta,
      isPlainObject(golden) ? golden : null
    )) {
      mark('G1-GOLDEN-CHAIN', 'fail', 'BACKUP_VERIFICATION_INVALID', issue)
    }
  }
  if (download !== null) {
    for (const issue of validateDownloadEvidence(
      download,
      artifactMeta,
      isPlainObject(golden) ? golden : null
    )) {
      mark('G1-GOLDEN-CHAIN', 'fail', 'BACKUP_DOWNLOAD_INVALID', issue)
    }
  }

  if (!isPlainObject(repository) || repository.available !== true) {
    markGlobal('blocked', 'REPOSITORY_UNAVAILABLE', 'git repository state cannot be inspected')
  } else {
    if (repository.gitError === true) {
      markGlobal('fail', 'REPOSITORY_INSPECTION_FAILED', 'one or more git inspection commands failed')
    }
    if (!isNonEmptyString(repository.head, 64)) {
      markGlobal('fail', 'REPOSITORY_HEAD_MISSING', 'git HEAD is missing')
    }
    if (repository.gitignoreHasPlans !== true) {
      markGlobal('fail', 'PLANS_NOT_IGNORED', '.gitignore must contain the docs/plans/ entry')
    }
    if (repository.plansIgnored !== true) {
      markGlobal(
        'fail',
        'PLANS_CHECK_IGNORE_FAILED',
        'git check-ignore must confirm docs/plans/ evidence is ignored'
      )
    }
    if (!Array.isArray(repository.trackedPlans)) {
      markGlobal('fail', 'TRACKED_PLANS_UNKNOWN', 'tracked plan files cannot be determined')
    } else if (repository.trackedPlans.length > 0) {
      markGlobal(
        'fail',
        'PLANS_TRACKED',
        `${repository.trackedPlans.length} file(s) under docs/plans/ are tracked`
      )
    }
    if (repository.dirty !== false) {
      markGlobal('fail', 'WORKTREE_DIRTY', 'git worktree must be clean before the gate can pass')
    }
    if (repository.evidenceFresh !== true) {
      markGlobal('fail', 'EVIDENCE_STALE', 'evidence must be generated after the current source commit')
    }
    if (!Array.isArray(repository.prohibitedTracked)) {
      markGlobal('fail', 'PROHIBITED_ASSETS_UNKNOWN', 'tracked Cubism source assets cannot be determined')
    } else if (repository.prohibitedTracked.length > 0) {
      markGlobal(
        'fail',
        'PROHIBITED_ASSET_TRACKED',
        `${repository.prohibitedTracked.length} prohibited Cubism source asset(s) are tracked`
      )
    }
    if (repository.phase0AssetCheck !== true) {
      markGlobal('fail', 'PHASE0_ASSET_CHECK_FAILED', 'Phase 0 prohibited-assets scan must pass')
    }
  }

  let overallStatus = 'pass'
  for (const category of Object.values(categories)) {
    overallStatus = worstStatus(overallStatus, category.status)
  }
  for (const problem of problems) {
    overallStatus = worstStatus(overallStatus, problem.severity)
  }
  const exitCode = gateExitCode({ overallStatus })
  const head = isPlainObject(repository) && isNonEmptyString(repository.head, 64) ? repository.head : null
  const goldenValue = isPlainObject(golden) ? golden : null

  return {
    schemaVersion: GATE_SCHEMA_VERSION,
    generatedAt: (now instanceof Date ? now : new Date()).toISOString(),
    overallStatus,
    exitCode,
    head,
    tagAllowed: overallStatus === 'pass' && head !== null,
    mockOnly: goldenValue?.providerMode === 'mock' && goldenValue?.realProvidersVerified === false,
    realProvidersVerified: goldenValue?.realProvidersVerified === true,
    categories,
    evidence: {
      vitest: publicVitestSummary(vitest),
      playwright: publicPlaywrightSummary(playwright),
      goldenChain: evidence?.golden?.status ?? 'missing',
      sseReplay: evidence?.sse?.status ?? 'missing',
      backupArtifact:
        backupEntry?.status === 'ok' && artifactMeta !== null
          ? { status: 'ok', ...artifactMeta }
          : { status: backupEntry?.status ?? 'missing' },
      backupVerification: evidence?.verification?.status ?? 'missing',
      backupDownload: evidence?.download?.status ?? 'missing',
      phase0Prerequisite: evidence?.phase0Prerequisite?.status ?? 'missing',
      uiAxe: evidence?.axe?.status ?? 'missing',
      uiTokenLint: evidence?.tokenLint?.status ?? 'missing',
      uiVisuals: {
        required: UI_EVIDENCE_PAGES.length,
        valid: uiVisualCount
      }
    },
    repository: {
      available: isPlainObject(repository) && repository.available === true,
      head,
      plansIgnored: isPlainObject(repository) && repository.plansIgnored === true,
      trackedPlans:
        isPlainObject(repository) && Array.isArray(repository.trackedPlans)
          ? repository.trackedPlans.length
          : null,
      worktreeDirty: isPlainObject(repository) ? repository.dirty !== false : null,
      evidenceFresh: isPlainObject(repository) ? repository.evidenceFresh === true : null,
      prohibitedTracked:
        isPlainObject(repository) && Array.isArray(repository.prohibitedTracked)
          ? repository.prohibitedTracked.length
          : null,
      phase0AssetCheck: isPlainObject(repository) ? repository.phase0AssetCheck === true : null
    },
    problems
  }
}

export function gateExitCode(result) {
  if (result.overallStatus === 'pass') return 0
  if (result.overallStatus === 'fail') return 1
  return 2
}

function escapeMarkdownCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
}

export function renderGateMarkdown(result) {
  const lines = [
    '# Phase 1 Gate',
    '',
    `- Overall: **${result.overallStatus.toUpperCase()}**`,
    `- Exit code: ${result.exitCode}`,
    `- HEAD: ${result.head ?? '(unavailable)'}`,
    `- Mock-only: ${result.mockOnly ? 'yes' : 'no'}`,
    `- Real providers verified: ${result.realProvidersVerified ? 'yes' : 'no'}`,
    `- Tag allowed: ${result.tagAllowed ? 'yes' : 'no'}`,
    '',
    '## Categories',
    '',
    '| Gate | Status | Problems |',
    '| --- | --- | --- |'
  ]
  for (const [name, category] of Object.entries(result.categories)) {
    lines.push(
      `| ${escapeMarkdownCell(name)} | ${category.status.toUpperCase()} ` + `| ${category.problems.length} |`
    )
  }
  lines.push('', '## Problems', '')
  if (result.problems.length === 0) {
    lines.push('- None.')
  } else {
    for (const problem of result.problems) {
      const scope = problem.gate ?? 'repository'
      lines.push(
        `- [${problem.severity}] ${scope} \`${problem.code}\`: ` + escapeMarkdownCell(problem.message)
      )
    }
  }
  lines.push(
    '',
    '## Evidence',
    '',
    `- Vitest: ${result.evidence.vitest.status} ` +
      `(${result.evidence.vitest.totalTests} tests, ` +
      `${result.evidence.vitest.failedTests} failed, ` +
      `${result.evidence.vitest.skippedTests} skipped/non-passing)`,
    `- Playwright: ${result.evidence.playwright.status} ` +
      `(${result.evidence.playwright.totalTests} tests, ` +
      `${result.evidence.playwright.badTests} failed/skipped/retried)`,
    `- Golden chain: ${result.evidence.goldenChain}`,
    `- SSE replay: ${result.evidence.sseReplay}`,
    `- Phase 0 prerequisite: ${result.evidence.phase0Prerequisite}`,
    `- Backup artifact: ${result.evidence.backupArtifact.status}`,
    `- Backup verification: ${result.evidence.backupVerification}`,
    `- Backup download: ${result.evidence.backupDownload}`,
    `- UI axe: ${result.evidence.uiAxe}`,
    `- UI token lint: ${result.evidence.uiTokenLint}`,
    `- UI visuals: ${result.evidence.uiVisuals.valid}/` +
      `${result.evidence.uiVisuals.required} 1440x900 baselines`,
    '',
    'Evidence and plans are internal working documents and are ignored by git.',
    ''
  )
  return lines.join('\n')
}

function runGit(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
  return {
    ok: result.status === 0,
    stdout: typeof result.stdout === 'string' ? result.stdout : ''
  }
}

function runRepositoryCheck(root, script) {
  try {
    execFileSync(process.execPath, [resolve(root, script)], {
      cwd: root,
      stdio: 'pipe'
    })
    return true
  } catch {
    return false
  }
}

function isProhibitedAssetPath(filePath) {
  const lower = filePath.toLowerCase()
  const name = lower.split('/').pop() ?? lower
  return (
    lower.startsWith('docs/plans/') ||
    /(^|\/)(weights|blobs|runtime|userdata|model-cache|preview-cache)\//.test(lower) ||
    /\.(moc3|can3|cmo3|psd|psb|safetensors|ckpt|onnx)$/.test(lower) ||
    /(^|\/)\.env$/.test(lower) ||
    (/(^|\/)\.env\..+$/.test(lower) && !lower.endsWith('.env.example')) ||
    /\.(pem|key)$/.test(lower) ||
    (name.startsWith('live2dcubismcore') && name.endsWith('.js')) ||
    lower.startsWith('apps/desktop/src/renderer/public/live2d/')
  )
}

function inspectRepository(root, evidenceRoot) {
  const inside = runGit(root, ['rev-parse', '--is-inside-work-tree'])
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    return {
      available: false,
      head: null,
      gitignoreHasPlans: false,
      plansIgnored: false,
      trackedPlans: [],
      dirty: true,
      evidenceFresh: false,
      prohibitedTracked: [],
      phase0AssetCheck: false,
      gitError: true
    }
  }

  let gitError = false
  const headResult = runGit(root, ['rev-parse', 'HEAD'])
  const head = headResult.ok ? headResult.stdout.trim() : null
  if (!headResult.ok) gitError = true

  let gitignore = ''
  try {
    gitignore = readFileSync(join(root, '.gitignore'), 'utf8')
  } catch {
    gitignore = ''
  }
  const gitignoreHasPlans = gitignore.split(/\r?\n/).some((line) => line.trim() === 'docs/plans/')

  const plansIgnored = runGit(root, ['check-ignore', '-q', `${PHASE1_EVIDENCE_DIR}/gate.json`]).ok

  const trackedPlansResult = runGit(root, ['ls-files', '--', 'docs/plans'])
  if (!trackedPlansResult.ok) gitError = true
  const trackedPlans = trackedPlansResult.stdout.split(/\r?\n/).filter(Boolean)

  const statusResult = runGit(root, ['status', '--porcelain=v1', '--untracked-files=normal'])
  if (!statusResult.ok) gitError = true
  const dirty = !statusResult.ok || statusResult.stdout.trim().length > 0
  const commitTimeResult = runGit(root, ['show', '-s', '--format=%ct', 'HEAD'])
  if (!commitTimeResult.ok) gitError = true
  const commitTimeMs = Number(commitTimeResult.stdout.trim() || '0') * 1000
  const evidenceFiles = [
    'vitest.json',
    'playwright.json',
    'golden-chain.json',
    'sse-replay.json',
    'phase0-prerequisite.json',
    'backup/verification.json',
    'backup/download.json',
    'backup/character-export.zip',
    'ui/axe.json',
    'ui/token-lint.json',
    ...UI_EVIDENCE_PAGES.map((name) => `ui/visual/${name}-1440x900.png`)
  ]
  const evidenceFresh = evidenceFiles.every((file) => {
    try {
      return statSync(join(evidenceRoot, file)).mtimeMs + 1_000 >= commitTimeMs
    } catch {
      return false
    }
  })

  const allFilesResult = runGit(root, ['ls-files', '-z'])
  if (!allFilesResult.ok) gitError = true
  const prohibitedTracked = allFilesResult.stdout
    .split('\u0000')
    .filter(Boolean)
    .filter(isProhibitedAssetPath)
  const phase0AssetCheck = runRepositoryCheck(root, 'scripts/check-no-prohibited-assets.mjs')

  return {
    available: true,
    head,
    gitignoreHasPlans,
    plansIgnored,
    trackedPlans,
    dirty,
    evidenceFresh,
    prohibitedTracked,
    phase0AssetCheck,
    gitError
  }
}

function writeGateArtifacts(result, { jsonPath, markdownPath }) {
  mkdirSync(dirname(jsonPath), { recursive: true })
  writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  chmodSync(jsonPath, 0o600)
  mkdirSync(dirname(markdownPath), { recursive: true })
  writeFileSync(markdownPath, renderGateMarkdown(result), {
    encoding: 'utf8',
    mode: 0o600
  })
  chmodSync(markdownPath, 0o600)
}

const USAGE = [
  'Usage: node scripts/phase1-gate.mjs [options]',
  '',
  'Options:',
  `  --evidence-dir <path>  Evidence directory (default: ${PHASE1_EVIDENCE_DIR})`,
  '  --json <path>          Gate JSON output path (default: <evidence-dir>/gate.json)',
  '  --md <path>            Gate Markdown output path (default: <evidence-dir>/gate.md)',
  '  --help                 Print this help',
  ''
].join('\n')

function parseArguments(argv) {
  const options = {
    evidenceDir: PHASE1_EVIDENCE_DIR,
    jsonPath: null,
    markdownPath: null,
    help: false
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const readValue = () => {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a path`)
      }
      index += 1
      return value
    }
    if (argument === '--evidence-dir') {
      options.evidenceDir = readValue()
    } else if (argument === '--json') {
      options.jsonPath = readValue()
    } else if (argument === '--md') {
      options.markdownPath = readValue()
    } else if (argument === '--help') {
      options.help = true
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  return options
}

export function main(argv = process.argv.slice(2), options = {}) {
  const root = resolve(options.root ?? process.cwd())
  let parsed
  try {
    parsed = parseArguments(argv)
  } catch (error) {
    process.stderr.write(`phase1 gate: ${error.message}\n\n${USAGE}`)
    return 2
  }
  if (parsed.help) {
    process.stdout.write(USAGE)
    return 0
  }

  const evidenceRoot = resolve(root, parsed.evidenceDir)
  const evidence = {
    vitest: loadJsonEvidence(join(evidenceRoot, 'vitest.json')),
    playwright: loadJsonEvidence(join(evidenceRoot, 'playwright.json')),
    golden: loadJsonEvidence(join(evidenceRoot, 'golden-chain.json')),
    sse: loadJsonEvidence(join(evidenceRoot, 'sse-replay.json')),
    phase0Prerequisite: loadJsonEvidence(join(evidenceRoot, 'phase0-prerequisite.json')),
    verification: loadJsonEvidence(join(evidenceRoot, 'backup/verification.json')),
    download: loadJsonEvidence(join(evidenceRoot, 'backup/download.json')),
    backup: loadBytesEvidence(join(evidenceRoot, 'backup/character-export.zip')),
    axe: loadJsonEvidence(join(evidenceRoot, 'ui/axe.json')),
    tokenLint: loadJsonEvidence(join(evidenceRoot, 'ui/token-lint.json')),
    visuals: Object.fromEntries(
      UI_EVIDENCE_PAGES.map((name) => [
        name,
        loadBytesEvidence(join(evidenceRoot, 'ui/visual', `${name}-1440x900.png`))
      ])
    )
  }
  const result = evaluatePhase1Gate({
    evidence,
    repository: inspectRepository(root, evidenceRoot),
    root,
    now: new Date()
  })
  const jsonPath = parsed.jsonPath === null ? join(evidenceRoot, 'gate.json') : resolve(root, parsed.jsonPath)
  const markdownPath =
    parsed.markdownPath === null ? join(evidenceRoot, 'gate.md') : resolve(root, parsed.markdownPath)
  if (markdownPath === jsonPath) {
    process.stderr.write('phase1 gate: --json and --md must use different paths\n')
    return 2
  }
  try {
    writeGateArtifacts(result, { jsonPath, markdownPath })
  } catch {
    process.stderr.write('phase1 gate: failed to write gate evidence\n')
    return 2
  }

  process.stdout.write(`Phase 1 gate: ${result.overallStatus.toUpperCase()} (exit ${result.exitCode})\n`)
  for (const problem of result.problems) {
    process.stdout.write(
      `- [${problem.severity}] ${problem.gate ?? 'repository'} ` + `${problem.code}: ${problem.message}\n`
    )
  }
  return result.exitCode
}

const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isEntryPoint) {
  process.exitCode = main()
}
