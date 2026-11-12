export interface MocProbe {
  parameterIds: string[]
  partIds: string[]
  drawableCount: number
  canvasWidth: number
  canvasHeight: number
}

interface CubismCore {
  Version?: { csmGetVersion?: () => number }
  Moc: { fromArrayBuffer(buffer: ArrayBuffer): { release?: () => void } }
  Model: {
    fromMoc(moc: unknown): {
      parameters: { ids: string[]; count: number }
      parts: { ids: string[] }
      drawables: { count: number }
      canvasinfo?: { CanvasWidth: number; CanvasHeight: number }
      release?: () => void
    }
  }
}

function core(): CubismCore {
  const value = (globalThis as { Live2DCubismCore?: CubismCore }).Live2DCubismCore
  if (!value) throw new Error('LIVE2D_CORE_MISSING')
  return value
}

export function readCoreVersion(): string | null {
  const version = core().Version?.csmGetVersion?.()
  if (version === undefined) return null
  return [version >>> 24, (version >>> 16) & 0xff, (version >>> 8) & 0xff, version & 0xff].join('.')
}

export async function probeMoc3(url: string): Promise<MocProbe> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`MOCT_FETCH_FAILED_${response.status}`)
  const buffer = await response.arrayBuffer()
  const moc = core().Moc.fromArrayBuffer(buffer)
  const model = core().Model.fromMoc(moc)
  try {
    return {
      parameterIds: [...model.parameters.ids],
      partIds: [...model.parts.ids],
      drawableCount: model.drawables.count,
      canvasWidth: model.canvasinfo?.CanvasWidth ?? 0,
      canvasHeight: model.canvasinfo?.CanvasHeight ?? 0
    }
  } finally {
    model.release?.()
    moc.release?.()
  }
}
