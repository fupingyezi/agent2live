import { app, BrowserWindow, dialog } from 'electron'
import { createPetWindow, createStudioWindow } from './windows'
import { registerWindowIpc } from './ipc'
import { startSidecar, stopSidecar } from './sidecar'

app.setName('agent2live')
if (process.env.AGENT2LIVE_DATA_DIR) {
  app.setPath('userData', process.env.AGENT2LIVE_DATA_DIR)
}

function waitForFirstLoad(win: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    if (!win.webContents.isLoading()) {
      resolve()
      return
    }
    const done = (): void => resolve()
    win.webContents.once('did-finish-load', done)
    win.webContents.once('did-fail-load', done)
  })
}

async function createWindows(): Promise<void> {
  // Load the studio before the pet so the primary window is deterministically first
  // for Playwright's firstWindow() and for app activation ordering.
  await waitForFirstLoad(createStudioWindow())
  createPetWindow()
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
  await createWindows()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindows()
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
