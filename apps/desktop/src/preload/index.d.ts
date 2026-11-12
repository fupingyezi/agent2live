import type { Agent2LiveBridge } from './index'

declare global {
  interface Window {
    agent2live: Agent2LiveBridge
  }
}

export {}
