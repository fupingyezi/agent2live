import { spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  GATE_EVIDENCE_PATH,
  QUALITY_GATE_ID,
  REQUIRED_CHECKS,
  SCHEMA_VERSION,
  evaluatePhase05Gate,
  repositoryState
} from './phase0.5-gate.mjs'

const EVIDENCE_FILE = resolve(GATE_EVIDENCE_PATH)
const LIMITATIONS = [
  'This report covers the G0.5-QUALITY checks only; a pass does not imply the Phase 0 gates (G0-RENDER, G0-DATA, G0-DOCS) pass.'
]
const INTERNAL_ERROR_SUMMARY = 'internal error'
const WRITER_FAILURE = 'WRITER_FAILURE'
const PLAYWRIGHT_COMMAND = [
  'pnpm',
  'exec',
  'playwright',
  'test',
  'e2e/electron-shell.spec.ts',
  '--reporter=json'
]
const SHARED_CONTRACTS_COMMAND = [
  'pnpm',
  'vitest',
  'run',
  'packages/contracts/src/sidecar.test.ts',
  'apps/desktop/src/renderer/shared/http/client.test.ts',
  'apps/desktop/src/renderer/shared/probe-panel.test.tsx'
]

function display(command, tempDir) {
  return command.join(' ').split(tempDir).join('<tmp>')
}

function runStep(command, logFile, env = {}) {
  const startedAt = Date.now()
  const fd = openSync(logFile, 'a')
  try {
    const result = spawnSync(command[0], command.slice(1), {
      cwd: process.cwd(),
      stdio: ['ignore', fd, fd],
      env: { ...process.env, ...env }
    })
    return {
      exitCode: typeof result.status === 'number' ? result.status : -1,
      durationMs: Date.now() - startedAt
    }
  } finally {
    closeSync(fd)
  }
}

function runSimpleCheck(id, command, context) {
  const result = runStep(command, join(context.tempDir, `${id}.log`))
  return {
    command: display(command, context.tempDir),
    status: result.exitCode === 0 ? 'pass' : 'fail',
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    summary: `exit ${result.exitCode}`
  }
}

function runUnitCheck(context) {
  const reportFile = join(context.tempDir, 'unit.json')
  const command = ['pnpm', 'exec', 'vitest', 'run', '--reporter=json', `--outputFile=${reportFile}`]
  const result = runStep(command, join(context.tempDir, 'unit.log'))
  let report = null
  try {
    report = JSON.parse(readFileSync(reportFile, 'utf8'))
  } catch {
    report = null
  }
  const countsValid =
    report !== null &&
    typeof report === 'object' &&
    typeof report.success === 'boolean' &&
    Number.isInteger(report.numTotalTests) &&
    Number.isInteger(report.numFailedTests)
  let status = 'fail'
  let summary = `exit ${result.exitCode}`
  if (result.exitCode === 0 && countsValid) {
    const passed = report.success === true && report.numTotalTests > 0 && report.numFailedTests === 0
    status = passed ? 'pass' : 'fail'
    summary = `tests ${report.numTotalTests}, failed ${report.numFailedTests}`
  } else if (result.exitCode === 0) {
    summary = 'report missing or invalid'
  }
  return {
    command: display(command, context.tempDir),
    status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    summary
  }
}

function runElectronShellCheck(context) {
  const reportFile = join(context.tempDir, 'electron-shell.json')
  const logFile = join(context.tempDir, 'electron-shell.log')
  const startedAt = Date.now()
  let rebuild = null
  let playwright = null
  let restore = null
  try {
    rebuild = runStep(['pnpm', 'native:electron'], logFile)
    if (rebuild.exitCode === 0) {
      playwright = runStep(PLAYWRIGHT_COMMAND, logFile, {
        PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile
      })
    }
  } finally {
    restore = runStep(['pnpm', 'native:node'], logFile)
  }
  const durationMs = Date.now() - startedAt
  let report = null
  try {
    report = JSON.parse(readFileSync(reportFile, 'utf8'))
  } catch {
    report = null
  }
  const stats = report !== null && typeof report === 'object' ? report.stats : null
  const statsValid =
    stats !== null &&
    typeof stats === 'object' &&
    ['expected', 'unexpected', 'skipped', 'flaky'].every((key) => Number.isInteger(stats[key]))
  const statsPass =
    statsValid && stats.expected > 0 && stats.unexpected === 0 && stats.skipped === 0 && stats.flaky === 0
  const exitCode =
    rebuild.exitCode !== 0
      ? rebuild.exitCode
      : playwright !== null && playwright.exitCode !== 0
        ? playwright.exitCode
        : restore.exitCode
  const pass =
    rebuild.exitCode === 0 &&
    playwright !== null &&
    playwright.exitCode === 0 &&
    statsPass &&
    restore.exitCode === 0
  const parts = []
  if (rebuild.exitCode !== 0) parts.push(`native:electron exit ${rebuild.exitCode}`)
  if (rebuild.exitCode === 0 && playwright === null) parts.push('playwright not run')
  if (playwright !== null && playwright.exitCode !== 0) parts.push(`playwright exit ${playwright.exitCode}`)
  if (playwright !== null && !statsValid) parts.push('playwright stats missing')
  if (statsValid) {
    parts.push(
      `expected ${stats.expected}, unexpected ${stats.unexpected}, skipped ${stats.skipped}, flaky ${stats.flaky}`
    )
  }
  if (restore.exitCode !== 0) parts.push(`native:node exit ${restore.exitCode}`)
  if (parts.length === 0) parts.push('ok')
  return {
    command: [
      display(['pnpm', 'native:electron'], context.tempDir),
      display(PLAYWRIGHT_COMMAND, context.tempDir),
      display(['pnpm', 'native:node'], context.tempDir)
    ].join(' && '),
    status: pass ? 'pass' : 'fail',
    exitCode,
    durationMs,
    summary: parts.join('; ')
  }
}

const CHECKS = [
  {
    id: 'format',
    command: 'pnpm format:check',
    run: (context) => runSimpleCheck('format', ['pnpm', 'format:check'], context)
  },
  {
    id: 'codeStyle',
    command: 'pnpm check:code-style',
    run: (context) => runSimpleCheck('codeStyle', ['pnpm', 'check:code-style'], context)
  },
  {
    id: 'typecheckWorkspace',
    command: 'pnpm typecheck:workspace',
    run: (context) => runSimpleCheck('typecheckWorkspace', ['pnpm', 'typecheck:workspace'], context)
  },
  {
    id: 'typecheckRoot',
    command: 'pnpm typecheck:root',
    run: (context) => runSimpleCheck('typecheckRoot', ['pnpm', 'typecheck:root'], context)
  },
  {
    id: 'typecheckE2e',
    command: 'pnpm typecheck:e2e',
    run: (context) => runSimpleCheck('typecheckE2e', ['pnpm', 'typecheck:e2e'], context)
  },
  {
    id: 'typecheckSpikes',
    command: 'pnpm typecheck:spikes',
    run: (context) => runSimpleCheck('typecheckSpikes', ['pnpm', 'typecheck:spikes'], context)
  },
  {
    id: 'unit',
    command: 'pnpm exec vitest run --reporter=json --outputFile=<tmp>/unit.json',
    run: (context) => runUnitCheck(context)
  },
  {
    id: 'build',
    command: 'pnpm build',
    run: (context) => runSimpleCheck('build', ['pnpm', 'build'], context)
  },
  {
    id: 'electronShell',
    command:
      'pnpm native:electron && pnpm exec playwright test e2e/electron-shell.spec.ts --reporter=json && pnpm native:node',
    run: (context) => runElectronShellCheck(context)
  },
  {
    id: 'sharedContracts',
    command:
      'pnpm vitest run packages/contracts/src/sidecar.test.ts apps/desktop/src/renderer/shared/http/client.test.ts apps/desktop/src/renderer/shared/probe-panel.test.tsx',
    run: (context) => runSimpleCheck('sharedContracts', SHARED_CONTRACTS_COMMAND, context)
  }
]

if (CHECKS.map((entry) => entry.id).join(',') !== REQUIRED_CHECKS.join(',')) {
  throw new Error('CHECK_ORDER_MISMATCH')
}

export function runGuardedCheck(entry, tempDir) {
  const startedAt = Date.now()
  try {
    return entry.run({ tempDir })
  } catch {
    return {
      command: entry.command,
      status: 'fail',
      exitCode: -1,
      durationMs: Date.now() - startedAt,
      summary: INTERNAL_ERROR_SUMMARY
    }
  }
}

function resolvedSourceCommit(repository) {
  return typeof repository.head === 'string' && /^[0-9a-f]{40}$/.test(repository.head)
    ? repository.head
    : null
}

function createEvidence(results, repository, blocker) {
  const artifacts = results.map(({ id, exitCode, durationMs }) => ({ id, exitCode, durationMs }))
  return {
    schemaVersion: SCHEMA_VERSION,
    gate: QUALITY_GATE_ID,
    status: 'fail',
    recordedAt: new Date().toISOString(),
    sourceCommit: resolvedSourceCommit(repository),
    dirty: repository.dirty,
    commands: results.map((result) => result.command),
    checks: results.map(({ id, command, status, exitCode, durationMs, summary }) => ({
      id,
      command,
      status,
      exitCode,
      durationMs,
      summary
    })),
    artifacts,
    blocker,
    nextAction: '',
    machine: { platform: process.platform, arch: process.arch, node: process.version },
    limitations: LIMITATIONS
  }
}

function writeEvidence(evidence) {
  mkdirSync(dirname(EVIDENCE_FILE), { recursive: true })
  writeFileSync(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`)
}

function printSummary(status, blockers) {
  try {
    console.log(JSON.stringify({ status, blockers, report: GATE_EVIDENCE_PATH }, null, 2))
  } catch {
    // keep the process silent rather than crashing on a closed output stream
  }
}

function writerFailure() {
  let repository = { head: null, dirty: true }
  try {
    repository = repositoryState()
  } catch {
    repository = { head: null, dirty: true }
  }
  const results = CHECKS.map((entry) => ({
    id: entry.id,
    command: entry.command,
    status: 'fail',
    exitCode: -1,
    durationMs: 0,
    summary: INTERNAL_ERROR_SUMMARY
  }))
  const evidence = createEvidence(results, repository, WRITER_FAILURE)
  try {
    writeEvidence(evidence)
  } catch {
    // the safe summary below is the only remaining output
  }
  printSummary('fail', [WRITER_FAILURE])
  return 1
}

export function runPhase05EvidenceWriter() {
  let tempDir = null
  try {
    tempDir = mkdtempSync(join(tmpdir(), 'agent2live-phase0.5-'))
    const results = CHECKS.map((entry) => ({ id: entry.id, ...runGuardedCheck(entry, tempDir) }))
    const repository = repositoryState()
    const evidence = createEvidence(results, repository, null)
    const aggregate = evaluatePhase05Gate({ evidence, repository, artifacts: evidence.artifacts })
    evidence.status = aggregate.status
    evidence.blocker = aggregate.blockers.length > 0 ? aggregate.blockers.join('; ') : null
    evidence.nextAction =
      aggregate.status === 'pass'
        ? 'Phase 1 may cite this report only alongside fresh G0-RENDER, G0-DATA, and G0-DOCS evidence.'
        : 'Fix the failed checks, then rerun pnpm phase0.5:gate from a clean commit.'
    writeEvidence(evidence)
    const exitCode = aggregate.status === 'pass' ? 0 : aggregate.status === 'blocked' ? 2 : 1
    printSummary(aggregate.status, aggregate.blockers)
    return exitCode
  } catch {
    return writerFailure()
  } finally {
    if (tempDir !== null) {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        // the temporary directory is outside the repository
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = runPhase05EvidenceWriter()
  } catch {
    printSummary('fail', [WRITER_FAILURE])
    process.exitCode = 1
  }
}
