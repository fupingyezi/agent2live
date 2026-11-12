import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readEvidence as validateEvidence } from './evidence.mjs'

const EVIDENCE = resolve('docs/plans/evidence/phase0')
const OUT_JSON = resolve(EVIDENCE, 'gate.json')
const OUT_MD = resolve(EVIDENCE, 'gate.md')
const GATES = ['G0-RENDER', 'G0-DATA', 'G0-PROVIDER', 'G0-AGENT', 'G0-PSD2LIVE', 'G0-SEETHROUGH', 'G0-DOCS']

export function playwrightSummary(report) {
  const stats = report?.stats
  if (!stats || !Number.isInteger(stats.expected) || !Number.isInteger(stats.unexpected)) {
    return { pass: false, expected: null, unexpected: null, skipped: null, error: 'PLAYWRIGHT_STATS_MISSING' }
  }
  return {
    pass: stats.expected > 0 && stats.unexpected === 0,
    expected: stats.expected,
    unexpected: stats.unexpected,
    skipped: Number.isInteger(stats.skipped) ? stats.skipped : 0
  }
}

export function vitestSummary(report) {
  if (
    typeof report?.success !== 'boolean' ||
    !Number.isInteger(report?.numTotalTests) ||
    !Number.isInteger(report?.numFailedTests)
  ) {
    return { pass: false, total: null, passed: null, failed: null, error: 'VITEST_STATS_MISSING' }
  }
  return {
    pass: report.success === true && report.numTotalTests > 0 && report.numFailedTests === 0,
    total: report.numTotalTests,
    passed: Number.isInteger(report.numPassedTests) ? report.numPassedTests : null,
    failed: report.numFailedTests
  }
}

export function aggregateChecks(checks) {
  // fail 优先于 blocked：有确凿失败时不能被缺失证据掩盖。
  const values = Object.values(checks)
  return values.includes(false) ? 'fail' : values.includes('missing') ? 'blocked' : 'pass'
}

export function aggregateGateStatuses(gates) {
  if (!Array.isArray(gates) || gates.length === 0) return 'fail'
  if (gates.some((gate) => !['pass', 'fail', 'blocked'].includes(gate?.status))) return 'fail'
  if (gates.some((gate) => gate.status === 'fail')) return 'fail'
  if (gates.some((gate) => gate.status === 'blocked')) return 'blocked'
  return 'pass'
}

function readEvidence(relative) {
  const file = resolve(EVIDENCE, relative)
  if (!existsSync(file)) return { ok: false, file, error: 'EVIDENCE_MISSING' }
  try {
    return { ok: true, file, value: JSON.parse(readFileSync(file, 'utf8')) }
  } catch {
    return { ok: false, file, error: 'EVIDENCE_INVALID_JSON' }
  }
}

function readValidatedEvidence(relative, gate) {
  try {
    const value = validateEvidence(resolve(EVIDENCE, relative), gate)
    return { ok: true, file: resolve(EVIDENCE, relative), value }
  } catch (error) {
    return {
      ok: false,
      file: resolve(EVIDENCE, relative),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

function gate(gateId, status, blocker, checks, warnings = []) {
  return { gate: gateId, status, blocker: blocker ?? null, checks, warnings }
}

export function rendererPass(renderer) {
  return Boolean(
    renderer &&
      renderer.loaded === true &&
      renderer.animated === true &&
      renderer.idle === true &&
      renderer.requiredParameters === true &&
      typeof renderer.coreVersion === 'string' &&
      /^\d+\.\d+\.\d+\.\d+$/.test(renderer.coreVersion)
  )
}

export function matrixPass(matrix, requiredLabels) {
  if (!matrix || matrix.status !== 'pass' || !Array.isArray(matrix.results)) return false
  for (const label of requiredLabels) {
    const entry = matrix.results.find((result) => result.label === label)
    if (!entry || entry.loaded !== true || entry.animated !== true) return false
    if (!rendererPass(entry.renderers?.studio) || !rendererPass(entry.renderers?.pet)) return false
  }
  return true
}

export function completedGate(gateId, checks, blockedReason, failReason) {
  // fail 优先于 blocked：有确凿失败时不能被缺失证据掩盖。
  if (Object.values(checks).some((value) => value === false)) {
    return gate(gateId, 'fail', failReason, checks)
  }
  const missing = Object.entries(checks)
    .filter(([, value]) => value === 'missing')
    .map(([key]) => key)
  if (missing.length > 0) {
    return gate(gateId, 'blocked', `${blockedReason}:${missing.join(',')}`, checks)
  }
  return gate(gateId, 'pass', null, checks)
}

function evaluateRender() {
  const run = readValidatedEvidence('G0-RENDER/gate-run.json', 'G0-RENDER')
  if (!run.ok)
    return gate('G0-RENDER', 'blocked', run.error ?? 'RENDER_EVIDENCE_MISSING', { envelope: 'missing' })
  const checks = { ...run.value.data.checks }
  if (run.value.status === 'blocked')
    return gate('G0-RENDER', 'blocked', run.value.blocker ?? 'RENDER_BLOCKED', checks)
  if (run.value.status === 'fail')
    return gate('G0-RENDER', 'fail', run.value.blocker ?? 'RENDER_FAILED', checks)
  return completedGate('G0-RENDER', checks, 'RENDER_EVIDENCE_MISSING', 'RENDER_CHECK_FAILED')
}

function evaluateData() {
  const run = readValidatedEvidence('G0-DATA/gate-run.json', 'G0-DATA')
  const checks = run.ok && run.value.data?.checks ? run.value.data.checks : { evidence: 'missing' }
  if (!run.ok) return gate('G0-DATA', 'blocked', run.error ?? 'DATA_EVIDENCE_MISSING', checks)
  if (run.value.status === 'blocked')
    return gate('G0-DATA', 'blocked', run.value.blocker ?? 'DATA_BLOCKED', checks)
  if (run.value.status === 'fail') return gate('G0-DATA', 'fail', run.value.blocker ?? 'DATA_FAILED', checks)
  return completedGate('G0-DATA', checks, 'DATA_EVIDENCE_MISSING', 'DATA_CHECK_FAILED')
}

function evaluateProvider() {
  const run = readValidatedEvidence('G0-PROVIDER/gate-run.json', 'G0-PROVIDER')
  if (!run.ok)
    return gate('G0-PROVIDER', 'blocked', run.error ?? 'PROVIDER_EVIDENCE_MISSING', { envelope: 'missing' })
  const checks = { ...run.value.data.checks }
  if (run.value.status === 'blocked')
    return gate('G0-PROVIDER', 'blocked', run.value.blocker ?? 'PROVIDER_BLOCKED', checks)
  if (run.value.status === 'fail')
    return gate('G0-PROVIDER', 'fail', run.value.blocker ?? 'PROVIDER_FAILED', checks)
  const result = completedGate('G0-PROVIDER', checks, 'PROVIDER_EVIDENCE_MISSING', 'PROVIDER_CHECK_FAILED')
  const realVerified = run.value.data.realVerified === true
  if (result.status === 'pass' && !realVerified) result.warnings.push('REAL_PROVIDER_UNVERIFIED')
  result.details = { realVerified }
  return result
}

function evaluateAgent(label) {
  const run = readValidatedEvidence(`G0-AGENT/${label}-run.json`, 'G0-AGENT')
  if (!run.ok) {
    return gate('G0-AGENT', 'blocked', `${label}:${run.error ?? 'EVIDENCE_MISSING'}`, { envelope: 'missing' })
  }
  const checks = { ...run.value.data.checks }
  if (run.value.status === 'blocked') {
    return gate('G0-AGENT', 'blocked', `${label}:${run.value.blocker ?? 'BLOCKED'}`, checks)
  }
  if (run.value.status === 'fail') {
    return gate('G0-AGENT', 'fail', `${label}:${run.value.blocker ?? 'FAILED'}`, checks)
  }
  return completedGate(
    'G0-AGENT',
    checks,
    `AGENT_EVIDENCE_MISSING:${label}`,
    `AGENT_${label.toUpperCase()}_FAILED`
  )
}

function evaluatePsd2live() {
  const run = readValidatedEvidence('G0-PSD2LIVE/gate-run.json', 'G0-PSD2LIVE')
  if (!run.ok)
    return gate('G0-PSD2LIVE', 'blocked', run.error ?? 'PSD2LIVE_EVIDENCE_MISSING', { envelope: 'missing' })
  const checks = { ...run.value.data.checks }
  if (run.value.status === 'blocked') {
    return gate('G0-PSD2LIVE', 'blocked', run.value.blocker ?? 'PSD2LIVE_BLOCKED', checks)
  }
  if (run.value.status === 'fail') {
    return gate('G0-PSD2LIVE', 'fail', run.value.blocker ?? 'PSD2LIVE_FAILED', checks)
  }
  return completedGate('G0-PSD2LIVE', checks, 'PSD2LIVE_EVIDENCE_MISSING', 'PSD2LIVE_CHECK_FAILED')
}

function evaluateSeethrough() {
  const run = readValidatedEvidence('G0-SEETHROUGH/gate-run.json', 'G0-SEETHROUGH')
  if (!run.ok)
    return gate('G0-SEETHROUGH', 'blocked', run.error ?? 'SEETHROUGH_EVIDENCE_MISSING', {
      envelope: 'missing'
    })
  const checks = { ...run.value.data.checks }
  if (run.value.status === 'blocked') {
    return gate('G0-SEETHROUGH', 'blocked', run.value.blocker ?? 'SEETHROUGH_BLOCKED', checks)
  }
  if (run.value.status === 'fail') {
    return gate('G0-SEETHROUGH', 'fail', run.value.blocker ?? 'SEETHROUGH_FAILED', checks)
  }
  return completedGate('G0-SEETHROUGH', checks, 'SEETHROUGH_EVIDENCE_MISSING', 'SEETHROUGH_CHECK_FAILED')
}

function runCheck(script) {
  try {
    execFileSync(process.execPath, [script], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function fileContains(file, needle) {
  return existsSync(file) && readFileSync(file, 'utf8').includes(needle)
}

function evaluateDocs() {
  const official = readValidatedEvidence('G0-DOCS/official-sources.json', 'G0-DOCS')
  const required = [
    'docs/versions.md',
    'LICENSE',
    'docs/decisions/0001-cubism-runtime.md',
    'docs/decisions/0002-agent-runtime.md',
    'docs/decisions/0003-phase0-gate-policy.md',
    'docs/decisions/0004-phase0-scope.md',
    'docs/decisions/0006-single-user-workspace.md',
    'docs/contracts/see-through-worker-v1.md',
    'docs/research/2026-11-09-seedream-layer-decomposition.md'
  ]
  const checks = {
    files: required.every((file) => existsSync(file)),
    gpl: fileContains('LICENSE', 'GNU GENERAL PUBLIC LICENSE') && fileContains('LICENSE', 'Version 3'),
    versions:
      fileContains('docs/versions.md', 'Node') &&
      fileContains('docs/versions.md', 'Cubism') &&
      Boolean(official.ok),
    officialSources: !official.ok
      ? 'missing'
      : official.value.status === 'pass' && Object.values(official.value.data?.checks ?? {}).every(Boolean),
    plansIgnored: runCheck('scripts/check-plans-ignored.mjs'),
    noProhibited: runCheck('scripts/check-no-prohibited-assets.mjs')
  }
  if (!official.ok) {
    return gate('G0-DOCS', 'blocked', official.error ?? 'OFFICIAL_SOURCES_MISSING', checks)
  }
  if (official.value.status === 'blocked') {
    return gate('G0-DOCS', 'blocked', official.value.blocker ?? 'OFFICIAL_SOURCES_BLOCKED', checks)
  }
  const pass = Object.values(checks).every((value) => value === true)
  return gate('G0-DOCS', pass ? 'pass' : 'fail', pass ? null : 'DOCS_CHECK_FAILED', checks)
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function artifactList() {
  const relative = [
    'G0-RENDER/gate-run.json',
    'G0-DATA/gate-run.json',
    'G0-PROVIDER/gate-run.json',
    'G0-AGENT/codex-run.json',
    'G0-AGENT/claude-run.json',
    'G0-PSD2LIVE/gate-run.json',
    'G0-SEETHROUGH/gate-run.json',
    'G0-DOCS/official-sources.json'
  ]
  return relative
    .map((path) => {
      const file = resolve(EVIDENCE, path)
      return existsSync(file) ? { path: `docs/plans/evidence/phase0/${path}`, sha256: sha256(file) } : null
    })
    .filter(Boolean)
}

function writeMarkdown(report) {
  const lines = [
    '# Phase 0 gate report',
    '',
    `Overall: **${report.status.toUpperCase()}**`,
    '',
    `Recorded: ${report.recordedAt}`,
    '',
    `Commit: ${report.commit}`,
    '',
    `Platform scope: ${report.platformScope}`,
    '',
    '| Gate | Status | Blocker | Warnings | Checks |',
    '| --- | --- | --- | --- | --- |',
    ...report.gates.map(
      (entry) =>
        `| ${entry.gate} | ${entry.status} | ${entry.blocker ?? ''} | ${(entry.warnings ?? []).join(', ')} | ${JSON.stringify(entry.checks)} |`
    ),
    ''
  ]
  writeFileSync(OUT_MD, `${lines.join('\n')}\n`)
}

function main() {
  const providerGates = [evaluateAgent('codex'), evaluateAgent('claude')]
  const agentStatus = aggregateGateStatuses(providerGates)
  const agentGate = gate(
    'G0-AGENT',
    agentStatus,
    agentStatus === 'pass'
      ? null
      : providerGates
          .filter((entry) => entry.status !== 'pass')
          .map((entry) => entry.blocker ?? entry.status)
          .join('; '),
    { codex: providerGates[0].status, claude: providerGates[1].status },
    providerGates.flatMap((entry) => entry.warnings)
  )

  const gates = [
    evaluateRender(),
    evaluateData(),
    evaluateProvider(),
    agentGate,
    evaluatePsd2live(),
    evaluateSeethrough(),
    evaluateDocs()
  ]
  if (gates.map((entry) => entry.gate).join(',') !== GATES.join(',')) {
    throw new Error('GATE_ORDER_MISMATCH')
  }
  let status = aggregateGateStatuses(gates)
  let commit = 'unknown'
  let dirty = true
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== ''
  } catch {
    // no commit yet
  }
  if (status === 'pass' && (commit === 'unknown' || dirty)) status = 'fail'
  const report = {
    schemaVersion: 'phase0-gate/1',
    gate: 'PHASE0',
    status,
    recordedAt: new Date().toISOString(),
    machine: { platform: process.platform, arch: process.arch, node: process.version },
    versions: { node: process.version },
    platformScope: 'macOS-arm64',
    commit,
    sourceCommit: commit,
    dirty,
    commands: ['pnpm phase0:gate'],
    observations: gates.map(({ gate: gateId, status: gateStatus, blocker, warnings, details }) => ({
      gate: gateId,
      status: gateStatus,
      blocker,
      warnings,
      details
    })),
    artifacts: artifactList(),
    blockers: gates
      .filter((entry) => entry.status !== 'pass')
      .map((entry) => `${entry.gate}:${entry.blocker ?? entry.status}`),
    nextAction:
      status === 'pass'
        ? 'tag phase0-gate and start Phase 1'
        : 'do not start Phase 1 beyond render/data/contracts/mock provider scope; resolve or re-scope blocked gates',
    gates
  }
  mkdirSync(EVIDENCE, { recursive: true })
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`)
  writeMarkdown(report)
  console.log(
    JSON.stringify({ status, blockers: report.blockers, report: OUT_JSON, markdown: OUT_MD }, null, 2)
  )
  process.exitCode = status === 'pass' ? 0 : status === 'blocked' ? 2 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
