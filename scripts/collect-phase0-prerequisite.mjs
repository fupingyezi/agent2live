import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const phase0Path = 'docs/plans/evidence/phase0/gate.json'
const phase05Path = 'docs/plans/evidence/phase0.5/gate.json'
const outputPath = 'docs/plans/evidence/phase1/phase0-prerequisite.json'
const required = ['G0-RENDER', 'G0-DATA', 'G0-DOCS']
const checks = {
  phase0GatePresent: existsSync(phase0Path),
  phase0GateValid: false,
  requiredGatesPass: false,
  requiredGateChecksPass: false,
  phase05GatePresent: existsSync(phase05Path),
  phase05GateValid: false,
  phase05QualityPass: false,
  phase05Clean: false,
  phase05CommitAncestor: false,
  phase0Clean: false,
  phase0CommitAncestor: false
}
let phase0 = null
let phase05 = null
let phase0SourceCommit = null
let phase05SourceCommit = null
let phase1Head = null
try {
  phase1Head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (checks.phase0GatePresent) {
    phase0 = JSON.parse(readFileSync(phase0Path, 'utf8'))
    checks.phase0GateValid = phase0?.schemaVersion === 'phase0-gate/1' && Array.isArray(phase0.gates)
    phase0SourceCommit = typeof phase0?.sourceCommit === 'string' ? phase0.sourceCommit : null
    checks.phase0Clean = phase0?.dirty === false
    const byGate = new Map(phase0.gates.map((entry) => [entry.gate, entry.status]))
    checks.requiredGatesPass = required.every((gate) => byGate.get(gate) === 'pass')
    const requiredChecks = {
      'G0-RENDER': ['shell', 'render', 'core', 'matrix'],
      'G0-DATA': [
        'migration',
        'migrationRollback',
        'sqliteVec',
        'fts5',
        'eventLog',
        'sseReplay',
        'electronAbi',
        'packagedApp',
        'benchmark'
      ],
      'G0-DOCS': ['files', 'gpl', 'versions', 'officialSources', 'plansIgnored', 'noProhibited']
    }
    checks.requiredGateChecksPass = Object.entries(requiredChecks).every(([gate, keys]) => {
      const entry = phase0.gates.find((candidate) => candidate.gate === gate)
      return entry && keys.every((key) => entry.checks?.[key] === true)
    })
    if (phase0SourceCommit) {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', phase0SourceCommit, 'HEAD'], {
          stdio: 'ignore'
        })
        checks.phase0CommitAncestor = true
      } catch {
        checks.phase0CommitAncestor = false
      }
    }
  }
  if (checks.phase05GatePresent) {
    phase05 = JSON.parse(readFileSync(phase05Path, 'utf8'))
    checks.phase05GateValid =
      phase05?.schemaVersion === 'phase0.5-quality-gate/1' &&
      phase05?.gate === 'G0.5-QUALITY' &&
      Array.isArray(phase05?.checks)
    phase05SourceCommit = typeof phase05?.sourceCommit === 'string' ? phase05.sourceCommit : null
    checks.phase05Clean = phase05?.dirty === false
    checks.phase05QualityPass =
      phase05?.status === 'pass' && phase05.checks.every((entry) => entry.status === 'pass')
    if (phase05SourceCommit) {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', phase05SourceCommit, 'HEAD'], {
          stdio: 'ignore'
        })
        checks.phase05CommitAncestor = true
      } catch {
        checks.phase05CommitAncestor = false
      }
    }
  }
} catch {
  // The evidence remains blocked; never turn a missing prerequisite into pass.
}
const status = Object.values(checks).every(Boolean) ? 'pass' : 'blocked'
mkdirSync('docs/plans/evidence/phase1', { recursive: true })
writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      schemaVersion: 'phase0-prerequisite/1',
      status,
      generatedAt: new Date().toISOString(),
      phase0SourceCommit,
      phase05SourceCommit,
      phase05Gate: 'G0.5-QUALITY',
      phase1Head,
      requiredGates: required,
      checks,
      data: { phase0, phase05 }
    },
    null,
    2
  )}\n`,
  { encoding: 'utf8', mode: 0o600 }
)
if (status !== 'pass') process.exitCode = 2
