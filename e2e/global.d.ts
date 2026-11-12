import type { Agent2LiveBridge } from '../apps/desktop/src/shared/ipc-contracts'

declare global {
  interface Window {
    agent2live: Agent2LiveBridge
  }
}

export {}
