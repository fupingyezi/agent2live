import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { writeEvidence } from './evidence.mjs'

const base = resolve('docs/plans/evidence/phase0')
const read = (relative) => {
  const file = resolve(base, relative)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}
const playwrightOk = (value) => Boolean(value?.stats?.expected > 0 && value.stats.unexpected === 0)
const vitestOk = (value) => Boolean(value?.success && value.numTotalTests > 0 && value.numFailedTests === 0)
const rendererOk = (renderer) =>
  Boolean(
    renderer?.loaded &&
      renderer.animated &&
      renderer.idle &&
      renderer.requiredParameters &&
      typeof renderer.coreVersion === 'string' &&
      /^\d+\.\d+\.\d+\.\d+$/.test(renderer.coreVersion)
  )
const matrixOk = (matrix, labels) =>
  Boolean(
    matrix?.status === 'pass' &&
      labels.every((label) => {
        const entry = matrix.results?.find((result) => result.label === label)
        return (
          entry?.loaded &&
          entry.animated &&
          rendererOk(entry.renderers?.studio) &&
          rendererOk(entry.renderers?.pet)
        )
      })
  )
const aggregate = (checks) => {
  const values = Object.values(checks)
  return values.includes('missing') ? 'blocked' : values.includes(false) ? 'fail' : 'pass'
}
const write = (gate, status, checks, artifacts, data = {}, blocker = null) =>
  writeEvidence(`docs/plans/evidence/phase0/${gate}/gate-run.json`, {
    gate,
    status,
    mode: 'real',
    commands: [`node scripts/write-gate-evidence.mjs (${gate})`],
    blocker: status === 'pass' ? null : (blocker ?? `${gate}_CHECK_FAILED`),
    nextAction: status === 'pass' ? 'run phase0 gate' : 'resolve the failed check and regenerate evidence',
    data: { checks, ...data },
    artifactPaths: artifacts
  })

const shell = read('G0-RENDER/shell.json')
const render = read('G0-RENDER/render.json')
const core = read('G0-RENDER/core-install.json')
const renderMatrix = read('G0-RENDER/matrix.json')
const renderChecks = {
  shell: shell ? playwrightOk(shell) : 'missing',
  render: render ? playwrightOk(render) : 'missing',
  core: core ? /^[0-9a-f]{64}$/.test(core.sha256 ?? '') && core.bytes >= 100_000 : 'missing',
  matrix: renderMatrix ? matrixOk(renderMatrix, ['haru']) : 'missing'
}
write(
  'G0-RENDER',
  aggregate(renderChecks),
  renderChecks,
  [
    'docs/plans/evidence/phase0/G0-RENDER/shell.json',
    'docs/plans/evidence/phase0/G0-RENDER/render.json',
    'docs/plans/evidence/phase0/G0-RENDER/core-install.json',
    'docs/plans/evidence/phase0/G0-RENDER/matrix.json'
  ].filter((file) => existsSync(resolve(file)))
)

const providerContract = read('G0-PROVIDER/contract-tests.json')
const providerSmoke = read('G0-PROVIDER/real-smoke.json')
const providerChecks = {
  contract: providerContract ? vitestOk(providerContract) : 'missing',
  realSmoke: !providerSmoke
    ? 'missing'
    : (providerSmoke.enabled === false &&
        providerSmoke.chat?.status === 'blocked' &&
        providerSmoke.image?.status === 'blocked') ||
      (providerSmoke.chat?.status === 'pass' && providerSmoke.image?.status === 'pass')
}
write(
  'G0-PROVIDER',
  aggregate(providerChecks),
  providerChecks,
  [
    'docs/plans/evidence/phase0/G0-PROVIDER/contract-tests.json',
    'docs/plans/evidence/phase0/G0-PROVIDER/real-smoke.json'
  ].filter((file) => existsSync(resolve(file))),
  {
    realVerified:
      providerSmoke?.enabled === true &&
      providerSmoke.chat?.status === 'pass' &&
      providerSmoke.image?.status === 'pass'
  }
)

for (const provider of ['codex', 'claude']) {
  const report = read(`G0-AGENT/${provider}.json`)
  const checks = {
    status: report ? report.status === 'pass' : 'missing',
    launch: report ? report.checks?.launch === true : 'missing',
    turn: report ? report.checks?.turn === true : 'missing',
    resume: report ? report.checks?.resume === true : 'missing',
    interrupt: report ? report.checks?.interrupt === true : 'missing',
    approval: report ? report.checks?.approval === true : 'missing',
    streaming: report ? report.checks?.streaming === true : 'missing'
  }
  const status = report?.status === 'pass' ? aggregate(checks) : (report?.status ?? 'blocked')
  writeEvidence(`docs/plans/evidence/phase0/G0-AGENT/${provider}-run.json`, {
    gate: 'G0-AGENT',
    status,
    mode: 'real',
    commands: [`pnpm probe:${provider}`],
    blocker: status === 'pass' ? null : (report?.blocker ?? `${provider.toUpperCase()}_CHECK_FAILED`),
    nextAction: status === 'pass' ? 'run phase0 gate' : 'resolve the probe failure and regenerate evidence',
    data: { checks, provider, blocker: report?.blocker ?? null },
    artifactPaths: [`docs/plans/evidence/phase0/G0-AGENT/${provider}.json`].filter((file) =>
      existsSync(resolve(file))
    )
  })
}

const psd = read('G0-PSD2LIVE/result.json')
const psdMatrix = read('G0-PSD2LIVE/render/matrix.json')
const export42 = psd?.exports?.['4.2']
const psdChecks = {
  fixture: psd ? psd.fixture?.kind === 'real' : 'missing',
  decomposition: psd ? psd.decomposition === 'pass' : 'missing',
  mcp: psd ? psd.mcp?.hasImport === true && psd.mcp?.hasExportTarget === true : 'missing',
  export42: psd ? export42?.status === 'pass' : 'missing',
  qc: psd ? export42?.qc?.pass === true : 'missing',
  render: psd && psdMatrix ? psd.render === 'pass' && matrixOk(psdMatrix, ['haru', 'psd42']) : 'missing'
}
const psdStatus = psd?.status === 'pass' ? aggregate(psdChecks) : (psd?.status ?? 'blocked')
write(
  'G0-PSD2LIVE',
  psdStatus,
  psdChecks,
  [
    'docs/plans/evidence/phase0/G0-PSD2LIVE/result.json',
    'docs/plans/evidence/phase0/G0-PSD2LIVE/render/matrix.json'
  ].filter((file) => existsSync(resolve(file))),
  {
    reason: psd?.reason ?? null,
    renderError: psd?.renderError ?? null
  },
  psd?.renderError ?? psd?.reason ?? null
)

const stub = read('G0-SEETHROUGH/stub-contract.json')
const real = read('G0-SEETHROUGH/real-worker.json')
const acceptance = read('G0-SEETHROUGH/psd2live-acceptance.json')
const qc = read('G0-SEETHROUGH/qc.json')
const seeMatrix = read('G0-SEETHROUGH/render/matrix.json')
const seeQuality = real?.metrics
const hashFile = (relative) =>
  createHash('sha256')
    .update(readFileSync(resolve(base, relative)))
    .digest('hex')
const seenModel3 = acceptance?.exports?.['4.2']?.model3
const seeChecks = {
  stub: stub ? stub.status === 'pass' : 'missing',
  real: real
    ? real.status === 'pass' &&
      real.scope === 'structure-and-quality' &&
      real.qualityStatus === 'pass' &&
      real.psd2liveAcceptance === 'pass'
    : 'missing',
  quality: seeQuality
    ? seeQuality.missingRequiredRoles?.length === 0 &&
      seeQuality.composite?.alphaIou >= 0.995 &&
      seeQuality.composite?.deltaE2000P95 <= 3 &&
      seeQuality.manualInterventionCount === 0
    : 'missing',
  acceptance: acceptance
    ? acceptance.status === 'pass' &&
      acceptance.psdSha256 === real?.psd?.sha256 &&
      acceptance.exports?.['4.2']?.status === 'pass' &&
      acceptance.exports?.['4.2']?.qcPass === true &&
      Boolean(seenModel3 && existsSync(seenModel3)) &&
      acceptance.exports?.['4.2']?.model3Sha256 ===
        createHash('sha256').update(readFileSync(seenModel3)).digest('hex') &&
      qc &&
      seeMatrix &&
      acceptance.qcEvidence?.sha256 === hashFile('G0-SEETHROUGH/qc.json') &&
      acceptance.render?.matrixSha256 === hashFile('G0-SEETHROUGH/render/matrix.json')
    : 'missing',
  qc: qc ? qc.pass === true : 'missing',
  render: seeMatrix ? matrixOk(seeMatrix, ['seeThrough']) : 'missing'
}
const seeStatus =
  real?.status === 'blocked' || acceptance?.status === 'blocked'
    ? 'blocked'
    : real?.status === 'fail' || acceptance?.status === 'fail'
      ? 'fail'
      : aggregate(seeChecks)
write(
  'G0-SEETHROUGH',
  seeStatus,
  seeChecks,
  [
    'docs/plans/evidence/phase0/G0-SEETHROUGH/stub-contract.json',
    'docs/plans/evidence/phase0/G0-SEETHROUGH/real-worker.json',
    'docs/plans/evidence/phase0/G0-SEETHROUGH/psd2live-acceptance.json',
    'docs/plans/evidence/phase0/G0-SEETHROUGH/qc.json',
    'docs/plans/evidence/phase0/G0-SEETHROUGH/render/matrix.json'
  ].filter((file) => existsSync(resolve(file))),
  {
    reason: real?.reason ?? acceptance?.reason ?? null
  },
  real?.reason ?? acceptance?.reason ?? null
)
