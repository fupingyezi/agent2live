import type { Agent2LiveBridge } from '../apps/desktop/src/preload'

declare global {
  interface Window {
    agent2live: Agent2LiveBridge
  }
}

export {}
