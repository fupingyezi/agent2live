import type { Live2DProbe } from '@agent2live/live2d-runtime'

export interface StageResult {
  probe: Live2DProbe
  modelUrl: string
}

export function modelUrlFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get('model')
  return value ? value : null
}

export async function mountModel(canvas: HTMLCanvasElement): Promise<StageResult> {
  const modelUrl = modelUrlFromSearch(window.location.search)
  if (!modelUrl) throw new Error('MODEL_NOT_CONFIGURED')
  const { loadLive2DModel } = await import('@agent2live/live2d-runtime')
  const loaded = await loadLive2DModel(canvas, modelUrl)
  const probe = await loaded.probe()
  return { probe, modelUrl }
}
