import type { Agent2LiveBridge } from '../../shared/ipc-contracts'
import type { Live2DProbe } from '@agent2live/live2d-runtime'

declare global {
  interface Window {
    agent2live: Agent2LiveBridge
    __agent2liveProbe?: Live2DProbe
  }
}

export {}
