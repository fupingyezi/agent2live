import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type Agent2LiveBridge } from '@desktop/shared'

const bridge: Agent2LiveBridge = {
  getWindowState: () => ipcRenderer.invoke(IPC_CHANNELS.getWindowState),
  setClickThrough: (enabled) => ipcRenderer.invoke(IPC_CHANNELS.setClickThrough, enabled),
  getLocalServiceInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getLocalServiceInfo),
  secrets: {
    store: (input) => ipcRenderer.invoke(IPC_CHANNELS.secretStore, input),
    has: (secretRef) => ipcRenderer.invoke(IPC_CHANNELS.secretHas, { secretRef }),
    delete: (secretRef) => ipcRenderer.invoke(IPC_CHANNELS.secretDelete, { secretRef })
  }
}

contextBridge.exposeInMainWorld('agent2live', bridge)
