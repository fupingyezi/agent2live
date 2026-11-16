import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { petPage, studioPage } from './support/windows'

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

interface ProbeSnapshot {
  coreVersion?: string | null
  parameterIds?: string[]
  motionGroups?: Record<string, number>
}

const REQUIRED_PARAMETERS = [
  'ParamAngleX',
  'ParamAngleY',
  'ParamAngleZ',
  'ParamBodyAngleX',
  'ParamEyeLOpen',
  'ParamEyeROpen',
  'ParamMouthOpenY'
] as const

const inputFile = process.env.AGENT2LIVE_MATRIX_FILE
const evidenceDir = process.env.AGENT2LIVE_EVIDENCE_DIR
const matrixConfigured = Boolean(inputFile && evidenceDir)

test.describe.configure({ mode: 'serial' })

if (!matrixConfigured) {
  test('matrix input is not configured', async () => {
    test.skip(true, 'AGENT2LIVE_MATRIX_FILE/EVIDENCE_DIR not configured')
  })
}

const models = matrixConfigured
  ? (JSON.parse(readFileSync(inputFile!, 'utf8')) as { models: MatrixInputModel[] }).models
  : []
const results: MatrixResult[] = []

function persist(): void {
  if (!evidenceDir) return
  mkdirSync(evidenceDir, { recursive: true })
  writeFileSync(join(evidenceDir, 'matrix-results.json'), `${JSON.stringify(results, null, 2)}\n`)
}

test.afterAll(() => persist())

function safeLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function emptyRenderer(status: string, error: string | null): RendererResult {
  return {
    status,
    loaded: false,
    animated: false,
    idle: false,
    requiredParameters: false,
    coreVersion: null,
    error,
    screenshot: null
  }
}

function failedResult(model: MatrixInputModel, error: string): MatrixResult {
  return {
    label: model.label,
    required: model.required,
    loaded: false,
    animated: false,
    status: 'error',
    error,
    probe: null,
    screenshot: null,
    renderers: {
      studio: emptyRenderer('error', error),
      pet: emptyRenderer('error', error)
    }
  }
}

async function inspectRenderer(page: Page, name: 'studio' | 'pet', label: string): Promise<RendererResult> {
  const status = page.locator('[data-testid="model-status"]')
  await page.waitForFunction(
    () => {
      const element = document.querySelector('[data-testid="model-status"]')
      return element?.textContent === 'ready' || element?.textContent === 'error'
    },
    null,
    { timeout: 30_000 }
  )
  const text = (await status.textContent()) ?? 'unknown'
  // An absent alert must not wait for the locator timeout before being treated as "no error".
  const alerts = page.locator('[role="alert"]')
  const error = (await alerts.count()) > 0 ? ((await alerts.first().textContent()) ?? null) : null
  const probe = (await page.evaluate(() => {
    return (
      (
        window as unknown as {
          __agent2liveProbe?: ProbeSnapshot
        }
      ).__agent2liveProbe ?? null
    )
  })) as ProbeSnapshot | null
  const canvas = page.locator('canvas')
  const before = await canvas.screenshot()
  await page.waitForTimeout(1200)
  const after = await canvas.screenshot()
  const animated = !(await sharp(before).raw().toBuffer()).equals(await sharp(after).raw().toBuffer())
  const screenshot = evidenceDir ? join(evidenceDir, `${name}-${safeLabel(label)}.png`) : null
  if (screenshot) await page.screenshot({ path: screenshot })
  return {
    status: text,
    loaded: text === 'ready' && Boolean(probe),
    animated: text === 'ready' && animated,
    idle: Number(probe?.motionGroups?.Idle ?? 0) > 0,
    requiredParameters: REQUIRED_PARAMETERS.every((id) => probe?.parameterIds?.includes(id)),
    coreVersion: probe?.coreVersion ?? null,
    error,
    screenshot
  }
}

for (const model of models) {
  test(`loads ${model.label} (model3 v${model.model3Version ?? '?'}, moc3 v${model.moc3Version})`, async () => {
    const dataDir = mkdtempSync(join(tmpdir(), `agent2live-matrix-${safeLabel(model.label)}-`))
    let app: ElectronApplication | null = null
    let result = failedResult(model, 'MATRIX_NOT_RUN')
    let populated = false
    try {
      app = await electron.launch({
        args: ['apps/desktop/out/main/index.js'],
        env: {
          ...process.env,
          AGENT2LIVE_DATA_DIR: dataDir,
          AGENT2LIVE_E2E: '1',
          AGENT2LIVE_SKIP_SIDECAR: '1',
          AGENT2LIVE_OPEN_PET: '1',
          AGENT2LIVE_MODEL_ROOT: model.root,
          AGENT2LIVE_MODEL_URL: model.modelUrl
        }
      })
      const studio = await studioPage(app)
      const pet = await petPage(app)
      const studioResult = await inspectRenderer(studio, 'studio', model.label)
      const petResult = await inspectRenderer(pet, 'pet', model.label)
      const loaded = studioResult.loaded && petResult.loaded
      const animated = studioResult.animated && petResult.animated
      result = {
        label: model.label,
        required: model.required,
        loaded,
        animated,
        status: loaded && animated ? 'ready' : 'error',
        error: studioResult.error ?? petResult.error,
        probe: studioResult,
        screenshot: studioResult.screenshot,
        renderers: { studio: studioResult, pet: petResult }
      }
      populated = true

      if (model.required) {
        for (const [name, renderer] of Object.entries(result.renderers)) {
          expect(renderer.loaded, `${name} failed to load: ${renderer.error ?? 'unknown'}`).toBe(true)
          expect(renderer.animated, `${name} did not render an Idle animation`).toBe(true)
          expect(renderer.idle, `${name} has no Idle motion group`).toBe(true)
          expect(renderer.requiredParameters, `${name} is missing required parameters (B07)`).toBe(true)
          expect(renderer.coreVersion, `${name} is missing Cubism Core version (B08)`).toMatch(
            /^\d+\.\d+\.\d+\.\d+$/
          )
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Optional models are recorded, never fatal. Required failures must fail the test.
      result = populated ? { ...result, error: result.error ?? message } : failedResult(model, message)
      if (model.required) throw error
    } finally {
      try {
        results.push(result)
        persist()
      } finally {
        if (app) await app.close().catch(() => undefined)
        rmSync(dataDir, { recursive: true, force: true })
      }
    }
  })
}
