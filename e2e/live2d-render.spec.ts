import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { petPage, studioPage } from './support/windows'

// Local fallback for developer machines that keep the official Cubism samples checked out.
// CI/other machines should point CUBISM_SAMPLE_ROOT at a directory containing Haru/Haru.model3.json.
const DEFAULT_MODEL_ROOT = '/Users/yoshiko/code/live2D/CubismWebSamples/Samples/Resources'
const MODEL_ROOT = process.env.CUBISM_SAMPLE_ROOT ?? DEFAULT_MODEL_ROOT
const MODEL_URL = 'agent2live-model://models/Haru/Haru.model3.json'

test.skip(
  !existsSync(join(MODEL_ROOT, 'Haru', 'Haru.model3.json')),
  'Haru sample model not available; set CUBISM_SAMPLE_ROOT'
)

test('studio and pet load the same Cubism 4 model, play Idle, and expose required parameters', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'agent2live-render-'))
  const app = await electron.launch({
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
  try {
    const studio = await studioPage(app)
    await expect(studio.locator('[data-testid="model-status"]')).toHaveText('ready', { timeout: 30_000 })
    const probe = await studio.evaluate(() => (window as any).__agent2liveProbe)
    expect(probe.coreVersion).toBeTruthy()
    expect(probe.motionGroups.Idle).toBeGreaterThan(0)
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
  } finally {
    await app.close()
  }
})
