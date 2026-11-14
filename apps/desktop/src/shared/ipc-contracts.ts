import type { SidecarInfo } from '@agent2live/contracts'

export const IPC_CHANNELS = {
  getWindowState: 'window:get-state',
  setClickThrough: 'window:set-click-through',
  getServerInfo: 'server:get-info',
  secretStore: 'secrets:store',
  secretHas: 'secrets:has',
  secretDelete: 'secrets:delete'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

export interface PetWindowState {
  visible: boolean
  clickThrough: boolean
  alwaysOnTop: boolean
  transparent: boolean
  focused: boolean
}

export interface Agent2LiveBridge {
  getWindowState(): Promise<PetWindowState>
  setClickThrough(enabled: boolean): Promise<PetWindowState>
  getServerInfo(): Promise<SidecarInfo>
  secrets: {
    store(input: { label: string; value: string }): Promise<{ secretRef: string }>
    has(secretRef: string): Promise<boolean>
    delete(secretRef: string): Promise<{ ok: true }>
  }
}
