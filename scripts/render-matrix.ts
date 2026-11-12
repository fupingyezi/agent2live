import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseArgs } from './lib/matrix-args'
import { readModelMeta } from './lib/model-meta'

const PLAYWRIGHT_TIMEOUT_MS = 10 * 60 * 1000
const CORE_VERSION_PATTERN = /^\d+\.\d+\.\d+\.\d+$/

interface MatrixInputModel {
  label: string
  required: boolean
  source: string
  root: string
  modelUrl: string
  model3Version: number | null
  moc3Version: number
  moc3VersionRaw: number
}

interface MatrixResult {
  label: string
  required: boolean
  loaded: boolean
  animated: boolean
  status: string
  error: string | null
  probe: unknown | null
  screenshot: string | null
  renderers: {
    studio: RendererResult
    pet: RendererResult
  }
}

interface RendererResult {
  status: string
  loaded: boolean
  animated: boolean
  idle: boolean
  requiredParameters: boolean
  coreVersion: string | null
  error: string | null
  screenshot: string | null
}

function entries(specs: string[], required: boolean): MatrixInputModel[] {
  return specs.map((spec) => {
    const split = spec.indexOf('=')
    if (split <= 0) throw new Error(`MATRIX_SPEC_INVALID:${spec}`)
    const label = spec.slice(0, split)
    const model3Path = resolve(spec.slice(split + 1))
    if (!existsSync(model3Path)) throw new Error(`MATRIX_MODEL_MISSING:${model3Path}`)
    const meta = readModelMeta(model3Path)
    return {
      label,
      required,
      source: model3Path,
      root: dirname(model3Path),
      modelUrl: `agent2live-model://models/${encodeURIComponent(basename(model3Path))}`,
      model3Version: meta.model3Version,
      moc3Version: meta.moc3Version,
      moc3VersionRaw: meta.moc3VersionRaw
    }
  })
}

function rendererPass(renderer: RendererResult | undefined): boolean {
  return Boolean(
    renderer &&
      renderer.loaded &&
      renderer.animated &&
      renderer.idle &&
      renderer.requiredParameters &&
      typeof renderer.coreVersion === 'string' &&
      CORE_VERSION_PATTERN.test(renderer.coreVersion)
  )
}

function resultPass(result: MatrixResult | undefined): boolean {
  return Boolean(
    result &&
      result.loaded &&
      result.animated &&
      rendererPass(result.renderers?.studio) &&
      rendererPass(result.renderers?.pet)
  )
}

function readResults(resultsFile: string): { results: MatrixResult[]; resultsError: string | null } {
  if (!existsSync(resultsFile)) return { results: [], resultsError: 'MATRIX_RESULTS_MISSING' }
  try {
    const parsed = JSON.parse(readFileSync(resultsFile, 'utf8')) as unknown
    if (!Array.isArray(parsed)) return { results: [], resultsError: 'MATRIX_RESULTS_INVALID' }
    return { results: parsed as MatrixResult[], resultsError: null }
  } catch (error) {
    return {
      results: [],
      resultsError: `MATRIX_RESULTS_INVALID:${error instanceof Error ? error.message : String(error)}`
    }
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const models = [...entries(args.required, true), ...entries(args.optional, false)]
  if (models.length === 0) throw new Error('MATRIX_EMPTY')
  const duplicates = models
    .map((model) => model.label)
    .filter((label, index, all) => all.indexOf(label) !== index)
  if (duplicates.length > 0) throw new Error(`MATRIX_LABEL_DUPLICATE:${duplicates.join(',')}`)
  if (!models.some((model) => model.required)) throw new Error('MATRIX_NO_REQUIRED_MODEL')

  mkdirSync(args.evidenceDir, { recursive: true })
  const inputFile = resolve(args.evidenceDir, 'matrix-input.json')
  const resultsFile = resolve(args.evidenceDir, 'matrix-results.json')
  const playwrightLog = resolve(args.evidenceDir, 'matrix-playwright.log')
  const outputFile = resolve(args.evidenceDir, 'matrix.json')
  writeFileSync(inputFile, `${JSON.stringify({ gate: args.gate, models }, null, 2)}\n`)

  const child = spawnSync(
    'pnpm',
    ['exec', 'playwright', 'test', 'e2e/live2d-runtime-matrix.spec.ts', '--reporter=line'],
    {
      env: {
        ...process.env,
        AGENT2LIVE_MATRIX_FILE: inputFile,
        AGENT2LIVE_EVIDENCE_DIR: args.evidenceDir
      },
      encoding: 'utf8',
      timeout: PLAYWRIGHT_TIMEOUT_MS,
      maxBuffer: 20 * 1024 * 1024
    }
  )
  const spawnError = child.error ? `${child.error.name}:${child.error.message}` : null
  const playwrightTimedOut = Boolean(spawnError && /ETIMEDOUT|timed out/i.test(spawnError))
  writeFileSync(
    playwrightLog,
    `${child.stdout ?? ''}\n${child.stderr ?? ''}\n${spawnError ? `spawn-error: ${spawnError}\n` : ''}\n`
  )
  if (child.stdout) process.stdout.write(child.stdout)
  if (child.stderr) process.stderr.write(child.stderr)
  if (spawnError) console.error(spawnError)

  const { results, resultsError } = readResults(resultsFile)
  const requiredModels = models.filter((model) => model.required)
  const failedRequired = requiredModels.filter(
    (model) => !resultPass(results.find((entry) => entry.label === model.label))
  )
  const pass = child.status === 0 && !spawnError && resultsError === null && failedRequired.length === 0
  const summary = {
    gate: args.gate,
    status: pass ? 'pass' : 'fail',
    required: requiredModels.map((model) => model.label),
    optional: models.filter((model) => !model.required).map((model) => model.label),
    failedRequired: failedRequired.map((model) => model.label),
    playwrightExitCode: child.status,
    playwrightTimedOut,
    playwrightError: spawnError,
    resultsError,
    results,
    generatedAt: new Date().toISOString()
  }
  writeFileSync(outputFile, `${JSON.stringify(summary, null, 2)}\n`)

  console.log(
    JSON.stringify(
      {
        gate: args.gate,
        status: summary.status,
        required: requiredModels.length,
        failedRequired: summary.failedRequired,
        evidence: outputFile
      },
      null,
      2
    )
  )
  process.exitCode = pass ? 0 : 1
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
