import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { qcModelDirectory } from '../../packages/live2d-runtime/src/qc-min'

const EVIDENCE = resolve('docs/plans/evidence/phase0/G0-PSD2LIVE')
const WORK = resolve('spikes/psd2live/work')
const fixture = resolve(WORK, 'fixture.psd')
const output = resolve(WORK, 'cli-model')
const evidenceFile = join(EVIDENCE, 'cli.json')
const failureLog = join(EVIDENCE, 'cli-failure.log')
const TIMEOUT_MS = 20 * 60_000

interface CliEvidence {
  gate: 'G0-PSD2LIVE'
  probe: 'cli'
  status: 'pass' | 'fail' | 'blocked'
  reason: string | null
  psd2liveDir: string | null
  commit: string | null
  exitCode: number | null
  model3: string | null
  url: string | null
  sha256: string | null
  qc: unknown
  startedAt: string
  finishedAt: string
}

function write(report: CliEvidence): void {
  mkdirSync(EVIDENCE, { recursive: true })
  writeFileSync(evidenceFile, `${JSON.stringify(report, null, 2)}\n`)
}

function redact(value: string): string {
  const token = process.env.PSD2LIVE_MCP_TOKEN
  return token ? value.split(token).join('[REDACTED]') : value
}

function writeFailureLog(contents: string): void {
  mkdirSync(EVIDENCE, { recursive: true })
  writeFileSync(failureLog, `${redact(contents)}\n`)
}

function findModel3(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.model3.json')) found.push(full)
    }
  }
  if (existsSync(root)) walk(root)
  return found
}

function commitOf(dir: string): string | null {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

function hasJdk21(): boolean {
  const home = process.env.JAVA_HOME
  if (!home) return false
  const java = join(home, 'bin', 'java')
  if (!existsSync(java)) return false
  const version = spawnSync(java, ['-version'], { encoding: 'utf8' })
  const output = `${version.stdout ?? ''}${version.stderr ?? ''}`
  return /version "21[."]/.test(output)
}

function classifyFailure(
  status: number | null,
  error: Error | undefined,
  stderr: string
): {
  status: 'fail' | 'blocked'
  reason: string
} {
  if (error && 'code' in error && error.code === 'ETIMEDOUT') {
    return { status: 'blocked', reason: `CLI_TIMEOUT_${TIMEOUT_MS}MS` }
  }
  if (/JavaFX|HeadlessException|AWTException|NSWindow|FX application thread|no DISPLAY/i.test(stderr)) {
    return { status: 'blocked', reason: 'MACOS_GUI_RUNTIME' }
  }
  if (
    /Could not resolve|Could not download|Connection reset|UnknownHostException|Could not connect|Network is unreachable|repo1\.maven/i.test(
      stderr
    )
  ) {
    return { status: 'blocked', reason: 'GRADLE_BUILD_NETWORK' }
  }
  if (
    /Unsupported class file major version|invalid source release|Unsupported Java|requires Java/i.test(stderr)
  ) {
    return { status: 'blocked', reason: 'JDK21_MISSING' }
  }
  return { status: 'fail', reason: status === null ? 'CLI_KILLED' : `CLI_EXIT_${status}` }
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString()
  const report: CliEvidence = {
    gate: 'G0-PSD2LIVE',
    probe: 'cli',
    status: 'blocked',
    reason: null,
    psd2liveDir: null,
    commit: null,
    exitCode: null,
    model3: null,
    url: null,
    sha256: null,
    qc: null,
    startedAt,
    finishedAt: startedAt
  }

  const psd2liveDir = process.env.PSD2LIVE_DIR
  if (!psd2liveDir) {
    report.reason = 'PSD2LIVE_DIR_MISSING'
    report.finishedAt = new Date().toISOString()
    write(report)
    console.error('blocked: set PSD2LIVE_DIR to the PSD2Live source checkout')
    process.exitCode = 2
    return
  }
  report.psd2liveDir = psd2liveDir
  report.commit = commitOf(psd2liveDir)
  const gradlew = join(psd2liveDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
  if (!existsSync(gradlew) || !existsSync(fixture)) {
    report.reason = !existsSync(gradlew) ? 'PSD2LIVE_GRADLEW_MISSING' : 'FIXTURE_MISSING'
    report.finishedAt = new Date().toISOString()
    write(report)
    process.exitCode = 2
    return
  }
  if (!hasJdk21()) {
    report.reason = 'JDK21_MISSING'
    report.finishedAt = new Date().toISOString()
    write(report)
    console.error('blocked: set JAVA_HOME to a JDK 21 installation')
    process.exitCode = 2
    return
  }

  rmSync(output, { recursive: true, force: true })
  mkdirSync(output, { recursive: true })

  const args = ['--no-daemon', 'run', `--args=--input ${fixture} --output ${output} --no-cmo3 --no-json`]
  const result = spawnSync(gradlew, args, {
    cwd: psd2liveDir,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env }
  })
  report.exitCode = result.status ?? -1
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')

  if (result.status !== 0) {
    const failure = classifyFailure(result.status, result.error, result.stderr ?? '')
    report.status = failure.status
    report.reason = failure.reason
    report.finishedAt = new Date().toISOString()
    write(report)
    writeFailureLog(
      [
        `command: ${gradlew} ${args.join(' ')}`,
        `cwd: ${psd2liveDir}`,
        `status: ${report.status}`,
        `reason: ${report.reason}`,
        `exitCode: ${String(result.status)}`,
        `signal: ${String(result.signal)}`,
        '',
        '--- stdout ---',
        result.stdout ?? '',
        '--- stderr ---',
        result.stderr ?? ''
      ].join('\n')
    )
    process.exitCode = failure.status === 'blocked' ? 2 : 1
    return
  }

  const models = findModel3(output)
  if (models.length !== 1) {
    report.status = 'fail'
    report.reason = models.length === 0 ? 'MODEL3_NOT_FOUND' : 'MODEL3_AMBIGUOUS'
    report.finishedAt = new Date().toISOString()
    write(report)
    process.exitCode = 1
    return
  }

  const model3 = models[0]!
  const qc = await qcModelDirectory(dirname(model3), basename(model3))
  report.model3 = relative(WORK, model3).split(sep).join('/')
  report.url = `agent2live-model://models/${report.model3}`
  report.sha256 = createHash('sha256').update(readFileSync(model3)).digest('hex')
  report.qc = qc
  report.status = qc.pass ? 'pass' : 'fail'
  report.reason = qc.pass ? null : `QC_BLOCKERS_${qc.blockers.join(',')}`
  report.finishedAt = new Date().toISOString()
  write(report)
  process.exitCode = qc.pass ? 0 : 1
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : 'PSD2LIVE_CLI_PROBE_FAILED'))
  process.exitCode = 1
})
