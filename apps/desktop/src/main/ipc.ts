import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@desktop/shared'
import { getPetWindow, getPetWindowState, getStudioWindow, setPetClickThrough } from './windows'
import { getSidecarInfo } from './sidecar'
import { secretRefSchema, secretStoreSchema } from './schema'
import { getSecretVault } from './secrets'

function assertPetSender(senderId: number): void {
  const pet = getPetWindow()
  if (!pet || pet.webContents.id !== senderId) {
    throw new Error('window is not allowed to call pet IPC')
  }
}

function assertStudioSender(senderId: number): void {
  const studio = getStudioWindow()
  if (!studio || studio.isDestroyed() || studio.webContents.id !== senderId) {
    throw new Error('FORBIDDEN')
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
  ipcMain.handle(IPC_CHANNELS.getLocalServiceInfo, () => {
    const info = getSidecarInfo()
    if (!info) throw new Error('local service is not ready')
    return info
  })
}

export function registerSecretIpc(): void {
  ipcMain.handle(IPC_CHANNELS.secretStore, (event, raw: unknown) => {
    assertStudioSender(event.sender.id)
    const input = secretStoreSchema.parse(raw)
    return getSecretVault().put(input.label, input.value)
  })
  ipcMain.handle(IPC_CHANNELS.secretHas, (event, raw: unknown) => {
    assertStudioSender(event.sender.id)
    return getSecretVault().has(secretRefSchema.parse(raw).secretRef)
  })
  ipcMain.handle(IPC_CHANNELS.secretDelete, (event, raw: unknown) => {
    assertStudioSender(event.sender.id)
    getSecretVault().delete(secretRefSchema.parse(raw).secretRef)
    return { ok: true }
  })
}
