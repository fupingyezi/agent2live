import { ipcMain } from 'electron'
import { getPetWindow, getPetWindowState, setPetClickThrough } from './windows'
import { getSidecarInfo } from './sidecar'

function assertPetSender(senderId: number): void {
  const pet = getPetWindow()
  if (!pet || pet.webContents.id !== senderId) {
    throw new Error('window is not allowed to call pet IPC')
  }
}

export function registerWindowIpc(): void {
  ipcMain.handle('window:get-state', (event) => {
    assertPetSender(event.sender.id)
    return getPetWindowState()
  })
  ipcMain.handle('window:set-click-through', (event, value: unknown) => {
    assertPetSender(event.sender.id)
    if (typeof value !== 'boolean') throw new Error('click-through value must be boolean')
    return setPetClickThrough(value)
  })
  ipcMain.handle('server:get-info', () => {
    const info = getSidecarInfo()
    if (!info) throw new Error('sidecar is not ready')
    return info
  })
}
