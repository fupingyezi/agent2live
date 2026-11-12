import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-contracts'
import { getPetWindow, getPetWindowState, setPetClickThrough } from './windows'
import { getSidecarInfo } from './sidecar'

function assertPetSender(senderId: number): void {
  const pet = getPetWindow()
  if (!pet || pet.webContents.id !== senderId) {
    throw new Error('window is not allowed to call pet IPC')
  }
}

export function registerWindowIpc(): void {
  ipcMain.handle(IPC_CHANNELS.getWindowState, (event) => {
    assertPetSender(event.sender.id)
    return getPetWindowState()
  })
  ipcMain.handle(IPC_CHANNELS.setClickThrough, (event, value: unknown) => {
    assertPetSender(event.sender.id)
    if (typeof value !== 'boolean') throw new Error('click-through value must be boolean')
    return setPetClickThrough(value)
  })
  ipcMain.handle(IPC_CHANNELS.getServerInfo, () => {
    const info = getSidecarInfo()
    if (!info) throw new Error('sidecar is not ready')
    return info
  })
}
