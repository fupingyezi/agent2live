import type { Live2DProbe } from '@agent2live/live2d-runtime'

export interface StageResult {
  probe: Live2DProbe
  modelUrl: string
}

export type EmptyProps = Record<string, never>
