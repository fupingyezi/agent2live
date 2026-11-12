import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { petPage, studioPage } from './support/windows'

// The Cubism model tree is never committed; point CUBISM_SAMPLE_ROOT or AGENT2LIVE_MODEL_ROOT
// at a model tree to run this spec. Without either variable the test skips with a clear message.
const MODEL_ROOT = process.env.AGENT2LIVE_MODEL_ROOT ?? process.env.CUBISM_SAMPLE_ROOT
const MODEL_URL = process.env.AGENT2LIVE_MODEL_URL ?? 'agent2live-model://models/Haru/Haru.model3.json'

function configuredModelPath(): string | null {
  try {
    const url = new URL(MODEL_URL)
    if (url.protocol !== 'agent2live-model:' || url.host !== 'models') return null
    return decodeURIComponent(url.pathname.replace(/^\/+/, '')) || null
  } catch {
    return null
  }
}

const modelPath = configuredModelPath()

// The Cubism Core is never committed; without it the harness cannot render any model.
test.skip(
  !existsSync(join(process.cwd(), 'apps/desktop/src/renderer/public/live2d/live2dcubismcore.min.js')),
  'Cubism Core is not installed locally'
)
// A skip is never a pass: the configured model must exist under the configured root.
test.skip(
  !MODEL_ROOT || !modelPath || !existsSync(join(MODEL_ROOT, modelPath)),
  'model not available; set AGENT2LIVE_MODEL_ROOT / AGENT2LIVE_MODEL_URL or CUBISM_SAMPLE_ROOT'
)

test('studio and pet load the same Cubism 4 model, play Idle, and expose required parameters', async () => {
  // The file-level skip above covers this; the guard keeps the launch env typed as string.
  if (!MODEL_ROOT) {
    throw new Error('AGENT2LIVE_MODEL_ROOT or CUBISM_SAMPLE_ROOT must be set to run this test')
  }
  const dataDir = mkdtempSync(join(tmpdir(), 'agent2live-render-'))
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({
      args: ['apps/desktop/out/main/index.js'],
      env: {
        ...process.env,
        AGENT2LIVE_DATA_DIR: dataDir,
        AGENT2LIVE_E2E: '1',
        AGENT2LIVE_SKIP_SIDECAR: '1',
        AGENT2LIVE_MODEL_ROOT: MODEL_ROOT,
        AGENT2LIVE_MODEL_URL: MODEL_URL
      }
    })
    const studio = await studioPage(app)
    await expect(studio.locator('[data-testid="model-status"]')).toHaveText('ready', { timeout: 30_000 })
    const probe = await studio.evaluate(() => (window as any).__agent2liveProbe)
    expect(probe.coreVersion).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
    expect(probe.motionGroups.Idle).toBeGreaterThan(0)
    expect(probe.idleStarted).toBe(true)
    for (const id of [
      'ParamAngleX',
      'ParamAngleY',
      'ParamAngleZ',
      'ParamBodyAngleX',
      'ParamEyeLOpen',
      'ParamEyeROpen',
      'ParamMouthOpenY'
    ]) {
      expect(probe.parameterIds).toContain(id)
    }

    const pet = await petPage(app)
    await expect(pet.locator('[data-testid="model-status"]')).toHaveText('ready', { timeout: 30_000 })
    const petProbe = await pet.evaluate(() => (window as any).__agent2liveProbe)
    expect(petProbe.parameterIds).toEqual(probe.parameterIds)

    const canvas = studio.locator('canvas')
    const before = await canvas.screenshot()
    await studio.waitForTimeout(1200)
    const after = await canvas.screenshot()
    const beforePixels = await sharp(before).raw().toBuffer()
    const afterPixels = await sharp(after).raw().toBuffer()
    expect(beforePixels.equals(afterPixels)).toBe(false)

    const evidenceDir = process.env.AGENT2LIVE_EVIDENCE_DIR
    if (evidenceDir) {
      mkdirSync(evidenceDir, { recursive: true })
      await studio.screenshot({ path: join(evidenceDir, 'studio.png') })
      await pet.screenshot({ path: join(evidenceDir, 'pet.png') })
      writeFileSync(
        join(evidenceDir, 'probe.json'),
        `${JSON.stringify(
          {
            modelUrl: MODEL_URL,
            probe,
            petProbe,
            pixelDiff: !beforePixels.equals(afterPixels)
          },
          null,
          2
        )}\n`
      )
    }
  } finally {
    try {
      if (app) await app.close()
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  }
})
