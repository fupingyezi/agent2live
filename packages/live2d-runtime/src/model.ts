import type { Live2DModel } from 'pixi-live2d-display-lipsyncpatch'
import type { Application } from 'pixi.js'
import { loadCubismCore } from './loader'
import { initStage } from './stage'
import { probeMoc3, readCoreVersion, type MocProbe } from './probe'

export interface Live2DProbe extends MocProbe {
  coreVersion: string | null
  motionGroups: Record<string, number>
  expressions: string[]
  idleStarted: boolean
}

export interface LoadedLive2D {
  model: Live2DModel
  app: Application
  probe(): Promise<Live2DProbe>
}

async function mocUrlFor(modelUrl: string): Promise<string> {
  const response = await fetch(modelUrl)
  if (!response.ok) throw new Error(`MODEL_ENTRY_NOT_FOUND_${response.status}`)
  const json = (await response.json()) as { FileReferences?: { Moc?: string } }
  const moc = json.FileReferences?.Moc
  if (!moc) throw new Error('MODEL_REFERENCE_INVALID')
  return new URL(moc, modelUrl).href
}

function fitModel(app: Application, model: Live2DModel): void {
  const scale = Math.min(app.renderer.width / model.width, app.renderer.height / model.height) * 0.9
  model.scale.set(Number.isFinite(scale) && scale > 0 ? scale : 1)
  model.anchor.set(0.5, 1)
  model.x = app.renderer.width / 2
  model.y = app.renderer.height
}

export async function loadLive2DModel(canvas: HTMLCanvasElement, url: string): Promise<LoadedLive2D> {
  await loadCubismCore()
  const app = initStage(canvas)
  // `./cubism4` avoids the package's root entry, which requires the Cubism 2
  // `live2d.min.js` runtime to be present on `window`.
  const mod = await import('pixi-live2d-display-lipsyncpatch/cubism4')
  const model = await mod.Live2DModel.from(url, { autoHitTest: false, autoFocus: false })
  app.stage.addChild(model)
  fitModel(app, model)
  let idleStarted = false
  try {
    idleStarted = await model.motion('Idle')
    if (!idleStarted) console.warn('idle motion did not start')
  } catch (error) {
    console.warn('idle motion failed to start', error)
  }
  const mocUrl = await mocUrlFor(url)
  return {
    model,
    app,
    async probe() {
      const moc = await probeMoc3(mocUrl)
      const definitions = model.internalModel.motionManager.definitions as Record<string, unknown[]>
      const settings = model.internalModel.settings as unknown as {
        expressions?: Array<{ Name?: string; name?: string }>
      }
      return {
        ...moc,
        coreVersion: readCoreVersion(),
        motionGroups: Object.fromEntries(
          Object.entries(definitions).map(([name, list]) => [name, list.length])
        ),
        expressions: (settings.expressions ?? []).map((e) => e.Name ?? e.name ?? '').filter(Boolean),
        idleStarted
      }
    }
  }
}
