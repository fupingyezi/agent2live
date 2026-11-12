import { app, BrowserWindow } from 'electron'
import { createPetWindow, createStudioWindow } from './windows'
import { registerWindowIpc } from './ipc'

app.setName('agent2live')
if (process.env.AGENT2LIVE_DATA_DIR) {
  app.setPath('userData', process.env.AGENT2LIVE_DATA_DIR)
}

function bootstrap(): void {
  registerWindowIpc()
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

  app.whenReady().then(bootstrap)

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
