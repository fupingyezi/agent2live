import { contextBridge, ipcRenderer } from 'electron'

export interface PetWindowState {
  visible: boolean
  clickThrough: boolean
  alwaysOnTop: boolean
  transparent: boolean
  focused: boolean
}

export interface SidecarInfo {
  baseUrl: string
  token: string
  pid: number
}

export interface Agent2LiveBridge {
  getWindowState(): Promise<PetWindowState>
  setClickThrough(enabled: boolean): Promise<PetWindowState>
  getServerInfo(): Promise<SidecarInfo>
}

const bridge: Agent2LiveBridge = {
  getWindowState: () => ipcRenderer.invoke('window:get-state'),
  setClickThrough: (enabled) => ipcRenderer.invoke('window:set-click-through', enabled),
  getServerInfo: () => ipcRenderer.invoke('server:get-info')
}

contextBridge.exposeInMainWorld('agent2live', bridge)
