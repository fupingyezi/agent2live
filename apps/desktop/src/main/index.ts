import { app, BrowserWindow, dialog } from 'electron'
import { createPetWindow, createStudioWindow } from './windows'
import { registerWindowIpc } from './ipc'
import { startSidecar, stopSidecar } from './sidecar'

app.setName('agent2live')
if (process.env.AGENT2LIVE_DATA_DIR) {
  app.setPath('userData', process.env.AGENT2LIVE_DATA_DIR)
}

async function bootstrap(): Promise<void> {
  registerWindowIpc()
  if (process.env.AGENT2LIVE_SKIP_SIDECAR !== '1') {
    try {
      await startSidecar()
    } catch (error) {
      console.error('sidecar failed to start', error)
      if (!process.env.AGENT2LIVE_E2E) {
        dialog.showErrorBox('agent2live 本地服务启动失败', String(error))
      }
    }
  }
  createStudioWindow()
  createPetWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createStudioWindow()
      createPetWindow()
    }
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const studio = BrowserWindow.getAllWindows().find((win) => win.getTitle().includes('Studio'))
    if (studio) {
      if (studio.isMinimized()) studio.restore()
      studio.show()
      studio.focus()
    }
  })

  app
    .whenReady()
    .then(bootstrap)
    .catch((error: unknown) => {
      console.error('bootstrap failed', error)
    })

  app.on('will-quit', () => stopSidecar())

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
