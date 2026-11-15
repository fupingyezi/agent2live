import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_EVIDENCE_DIR = 'docs/plans/evidence/phase1'
const REVIEW_SCHEMA = 'ui-design-review/1'
const REFERENCE_SCHEMA = 'ui-reference/1'
const REAL_PROVIDER_SCHEMA = 'real-providers/1'

function issue(category, status, message, problems, warnings) {
  const entry = { status, problems: message ? [message] : [] }
  if (status === 'fail' || status === 'blocked') problems.push(message)
  if (status === 'warning') warnings.push(message)
  category.status = status
  category.problems = entry.problems
}

function evaluatePhase1(phase1Gate, problems) {
  const category = { status: 'blocked', problems: [] }
  if (!phase1Gate || phase1Gate.__parseError) {
    issue(category, 'blocked', 'Phase 1 gate evidence is missing or malformed', problems, [])
    return category
  }
  if (phase1Gate.overallStatus !== 'pass' || phase1Gate.exitCode !== 0) {
    issue(category, 'fail', 'Phase 1 gate is not PASS', problems, [])
    return category
  }
  if (!Array.isArray(phase1Gate.problems) || phase1Gate.problems.length > 0) {
    issue(category, 'fail', 'Phase 1 gate contains unresolved problems', problems, [])
    return category
  }
  issue(category, 'pass', null, problems, [])
  return category
}

function evaluateVisual(phase1Gate, problems) {
  const category = { status: 'blocked', problems: [] }
  const visuals = phase1Gate?.evidence?.uiVisuals
  if (!visuals) {
    issue(category, 'blocked', 'Visual regression evidence is missing', problems, [])
    return category
  }
  if (!Number.isInteger(visuals.required) || visuals.required <= 0 || visuals.valid !== visuals.required) {
    issue(category, 'fail', 'Visual regression evidence is incomplete', problems, [])
    return category
  }
  issue(category, 'pass', null, problems, [])
  return category
}

function evaluateA11y(phase1Gate, problems) {
  const category = { status: 'blocked', problems: [] }
  const axe = phase1Gate?.evidence?.uiAxe
  const tokenLint = phase1Gate?.evidence?.uiTokenLint
  if (axe === undefined || tokenLint === undefined) {
    issue(category, 'blocked', 'Accessibility evidence is missing', problems, [])
    return category
  }
  if (axe !== 'ok' || tokenLint !== 'ok') {
    issue(category, 'fail', 'Accessibility or token evidence did not pass', problems, [])
    return category
  }
  issue(category, 'pass', null, problems, [])
  return category
}

function evaluateDesignReview(designReview, reference, problems) {
  const category = { status: 'blocked', problems: [] }
  if (!designReview || designReview.__parseError) {
    issue(category, 'blocked', 'Design review evidence is missing or malformed', problems, [])
    return category
  }
  if (designReview.status === 'pending') {
    issue(category, 'blocked', 'Design review has not been signed off', problems, [])
    return category
  }
  if (designReview.status !== 'approved') {
    issue(category, 'fail', 'Design review status must be approved', problems, [])
    return category
  }
  if (
    designReview.schemaVersion !== REVIEW_SCHEMA ||
    typeof designReview.reviewedAt !== 'string' ||
    designReview.reviewedAt.length === 0 ||
    typeof designReview.reviewer !== 'string' ||
    designReview.reviewer.length === 0
  ) {
    issue(category, 'fail', 'Design review metadata is invalid', problems, [])
    return category
  }
  if (!reference || reference.__parseError || reference.schemaVersion !== REFERENCE_SCHEMA) {
    issue(category, 'fail', 'Design reference manifest is missing or malformed', problems, [])
    return category
  }
  if (designReview.referenceSha256 !== reference.sha256) {
    issue(category, 'fail', 'Design review reference SHA-256 does not match the manifest', problems, [])
    return category
  }
  const expectedNames = new Set(
    Array.isArray(reference.pages)
      ? reference.pages.map((page) => page?.name).filter((name) => typeof name === 'string')
      : []
  )
  if (expectedNames.size !== 7 || !Array.isArray(designReview.pages)) {
    issue(category, 'fail', 'Design review must cover exactly the seven reference pages', problems, [])
    return category
  }
  const reviewNames = new Set()
  for (const page of designReview.pages) {
    if (!page || typeof page.name !== 'string' || reviewNames.has(page.name)) {
      issue(category, 'fail', 'Design review contains an invalid or duplicate page', problems, [])
      return category
    }
    reviewNames.add(page.name)
    if (page.status !== 'approved') {
      issue(category, 'fail', `Design page ${page.name} is not approved`, problems, [])
      return category
    }
    if (!Array.isArray(page.issues)) {
      issue(category, 'fail', `Design page ${page.name} has invalid issues`, problems, [])
      return category
    }
    if (page.issues.some((item) => item?.severity === 'P0' || item?.severity === 'P1')) {
      issue(category, 'fail', `Design page ${page.name} still has a P0/P1 issue`, problems, [])
      return category
    }
  }
  if (reviewNames.size !== expectedNames.size || [...expectedNames].some((name) => !reviewNames.has(name))) {
    issue(category, 'fail', 'Design review page set does not match the reference manifest', problems, [])
    return category
  }
  issue(category, 'pass', null, problems, [])
  return category
}

function evaluateRealProvider(name, realProviders, requireRealProviders, problems, warnings) {
  const category = { status: 'warning', problems: [] }
  if (!realProviders || realProviders.__parseError) {
    if (requireRealProviders) {
      issue(category, 'blocked', `Real ${name} provider evidence is missing`, problems, warnings)
    } else {
      issue(
        category,
        'warning',
        `Real ${name} provider evidence is not present; mock-only acceptance remains`,
        problems,
        warnings
      )
    }
    return category
  }
  if (realProviders.schemaVersion !== REAL_PROVIDER_SCHEMA) {
    issue(category, 'fail', `Real ${name} provider evidence schema is invalid`, problems, warnings)
    return category
  }
  const check = realProviders.checks?.[name]
  if (!check) {
    issue(category, 'blocked', `Real ${name} provider check is missing`, problems, warnings)
    return category
  }
  if (check.ok !== true || (realProviders.status !== 'pass' && realProviders.status !== 'partial')) {
    issue(
      category,
      'fail',
      `Real ${name} provider check failed${check.errorCode ? `: ${check.errorCode}` : ''}`,
      problems,
      warnings
    )
    return category
  }
  issue(category, 'pass', null, problems, warnings)
  return category
}

export function evaluateConvergenceGate({
  phase1Gate,
  designReview,
  reference,
  realProviders,
  requireRealProviders = false
}) {
  const problems = []
  const warnings = []
  const categories = {
    PHASE1: evaluatePhase1(phase1Gate, problems),
    'DESIGN-REVIEW': evaluateDesignReview(designReview, reference, problems),
    'REAL-CHAT': evaluateRealProvider('chat', realProviders, requireRealProviders, problems, warnings),
    'REAL-IMAGE': evaluateRealProvider('image', realProviders, requireRealProviders, problems, warnings),
    VISUAL: evaluateVisual(phase1Gate, problems),
    A11Y: evaluateA11y(phase1Gate, problems)
  }
  const statuses = Object.values(categories).map((category) => category.status)
  const overallStatus = statuses.includes('fail') ? 'fail' : statuses.includes('blocked') ? 'blocked' : 'pass'
  return {
    overallStatus,
    exitCode: overallStatus === 'fail' ? 1 : overallStatus === 'blocked' ? 2 : 0,
    categories,
    problems,
    warnings
  }
}

function readJson(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return { __parseError: true }
  }
}

function parseArgs(argv) {
  let evidenceDir = DEFAULT_EVIDENCE_DIR
  let requireRealProviders = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--require-real-providers') {
      requireRealProviders = true
    } else if (arg === '--evidence-dir') {
      evidenceDir = argv[index + 1] ?? ''
      index += 1
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return { evidenceDir, requireRealProviders }
}

function renderSummary(result) {
  const lines = [
    '# Phase 1 Convergence Gate',
    '',
    `- Overall: **${result.overallStatus.toUpperCase()}**`,
    `- Exit code: ${result.exitCode}`,
    '',
    '| Gate | Status | Problems |',
    '| --- | --- | --- |'
  ]
  for (const [name, category] of Object.entries(result.categories)) {
    lines.push(`| ${name} | ${category.status.toUpperCase()} | ${category.problems.length} |`)
  }
  lines.push('', '## Problems', '')
  lines.push(...(result.problems.length > 0 ? result.problems.map((entry) => `- ${entry}`) : ['- None.']))
  if (result.warnings.length > 0) {
    lines.push('', '## Warnings', '')
    lines.push(...result.warnings.map((entry) => `- ${entry}`))
  }
  return `${lines.join('\n')}\n`
}

function main() {
  try {
    const { evidenceDir, requireRealProviders } = parseArgs(process.argv.slice(2))
    const root = resolve(evidenceDir)
    const result = evaluateConvergenceGate({
      phase1Gate: readJson(join(root, 'gate.json')),
      designReview: readJson(join(root, 'ui', 'design-review.json')),
      reference: readJson(join(root, 'ui', 'reference.json')),
      realProviders: readJson(join(root, 'real-providers.json')),
      requireRealProviders
    })
    process.stdout.write(renderSummary(result))
    process.exitCode = result.exitCode
  } catch (error) {
    process.stderr.write(
      `phase1 convergence gate: ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exitCode = 2
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
}
