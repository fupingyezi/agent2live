import { contextBridge, ipcRenderer } from 'electron'

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
}

const bridge: Agent2LiveBridge = {
  getWindowState: () => ipcRenderer.invoke('window:get-state'),
  setClickThrough: (enabled) => ipcRenderer.invoke('window:set-click-through', enabled)
}

contextBridge.exposeInMainWorld('agent2live', bridge)
