import * as PIXI from 'pixi.js'
import '@pixi/unsafe-eval'

let app: PIXI.Application | null = null

export function initStage(canvas: HTMLCanvasElement): PIXI.Application {
  if (app) return app
  ;(window as unknown as { PIXI: typeof PIXI }).PIXI = PIXI
  app = new PIXI.Application({
    view: canvas,
    width: canvas.clientWidth || 420,
    height: canvas.clientHeight || 420,
    autoStart: true,
    backgroundAlpha: 0,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true
  })
  return app
}

export function destroyStage(): void {
  app?.destroy(false)
  app = null
}
