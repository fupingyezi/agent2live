import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { writeEvidence } from './evidence.mjs'

const dir = resolve('docs/plans/evidence/phase0/G0-DATA')
const json = (name) => JSON.parse(readFileSync(resolve(dir, name), 'utf8'))
const playwrightPass = (report) => report.stats?.expected > 0 && report.stats?.unexpected === 0
const testPassed = (report, title) =>
  report.testResults?.some((suite) =>
    suite.assertionResults?.some((test) => test.title.includes(title) && test.status === 'passed')
  )

const vitest = json('db-vitest.json')
const sidecar = json('data-sidecar.json')
const sidecarAuth = json('sidecar-auth.json')
const packaged = json('packaged-data.json')
const bench = json('data-bench.json')
const checks = {
  migration: testPassed(vitest, 'enables WAL, foreign keys'),
  migrationRollback: testPassed(vitest, 'rolls back a failed migration'),
  sqliteVec: testPassed(vitest, 'stores partitioned 768-d vectors'),
  fts5: testPassed(vitest, 'matches FTS5 unicode61 tokens'),
  eventLog: testPassed(vitest, 'assigns monotonic seq'),
  sseReplay: testPassed(vitest, 'streams event_log with SSE and replay cursor'),
  electronAbi: playwrightPass(sidecar),
  sidecarAuth: playwrightPass(sidecarAuth),
  packagedApp: playwrightPass(packaged),
  benchmark:
    bench.pass === true &&
    bench.mode === 'real' &&
    bench.vectorCount === 10000 &&
    bench.dimensions === 768 &&
    bench.thresholdP95Ms === 80 &&
    bench.p95Ms <= bench.thresholdP95Ms
}
const pass = Object.values(checks).every(Boolean)
writeEvidence('docs/plans/evidence/phase0/G0-DATA/gate-run.json', {
  gate: 'G0-DATA',
  status: pass ? 'pass' : 'fail',
  mode: 'real',
  commands: [
    'pnpm native:node',
    'LOG_LEVEL=silent pnpm vitest run apps/server/src/__tests__/db.test.ts apps/server/src/__tests__/events.test.ts apps/server/src/__tests__/app.test.ts --reporter=json --outputFile=docs/plans/evidence/phase0/G0-DATA/db-vitest.json',
    'pnpm bench:data',
    'pnpm native:electron',
    'pnpm pack:desktop',
    'LOG_LEVEL=silent pnpm exec playwright test e2e/sidecar.spec.ts --reporter=json > docs/plans/evidence/phase0/G0-DATA/sidecar-auth.json',
    'LOG_LEVEL=silent pnpm exec playwright test e2e/data-sidecar.spec.ts --reporter=json > docs/plans/evidence/phase0/G0-DATA/data-sidecar.json',
    'AGENT2LIVE_PACKAGED_APP=apps/desktop/release/mac-arm64/agent2live.app/Contents/MacOS/agent2live LOG_LEVEL=silent pnpm exec playwright test e2e/packaged-data.spec.ts --reporter=json > docs/plans/evidence/phase0/G0-DATA/packaged-data.json',
    'pnpm exec node scripts/write-data-evidence.mjs',
    'pnpm native:node'
  ],
  blocker: pass ? null : 'DATA_CHECK_FAILED',
  nextAction: pass ? 'allow Phase 1 data-layer work' : 'fix failed data checks and rerun from a clean commit',
  versions: { node: process.versions.node, electron: '44.7.2' },
  data: { checks },
  artifactPaths: [
    'docs/plans/evidence/phase0/G0-DATA/db-vitest.json',
    'docs/plans/evidence/phase0/G0-DATA/sidecar-auth.json',
    'docs/plans/evidence/phase0/G0-DATA/data-sidecar.json',
    'docs/plans/evidence/phase0/G0-DATA/packaged-data.json',
    'docs/plans/evidence/phase0/G0-DATA/data-bench.json'
  ]
})
if (!pass) process.exitCode = 1
