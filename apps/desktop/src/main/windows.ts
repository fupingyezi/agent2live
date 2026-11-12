import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import type { PetWindowState } from '../shared/ipc-contracts'

const preload = join(__dirname, '../preload/index.js')
const PET_TRANSPARENT = true

let studio: BrowserWindow | null = null
let pet: BrowserWindow | null = null
let clickThrough = false

function loadRenderer(win: BrowserWindow, name: 'studio' | 'pet'): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  const modelUrl = process.env.AGENT2LIVE_MODEL_URL
  const query = modelUrl ? `?model=${encodeURIComponent(modelUrl)}` : ''
  if (devUrl) void win.loadURL(`${devUrl}/${name}/index.html${query}`)
  else
    void win.loadFile(join(__dirname, `../renderer/${name}/index.html`), {
      query: modelUrl ? { model: modelUrl } : {}
    })
}

export function createStudioWindow(): BrowserWindow {
  if (studio && !studio.isDestroyed()) return studio
  studio = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: 'agent2live Studio',
    backgroundColor: '#F8FAF9',
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  studio.once('ready-to-show', () => studio?.show())
  studio.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  studio.webContents.on('will-navigate', (event, url) => {
    if (url !== studio?.webContents.getURL()) event.preventDefault()
  })
  loadRenderer(studio, 'studio')
  return studio
}

export function createPetWindow(): BrowserWindow {
  if (pet && !pet.isDestroyed()) return pet
  const area = screen.getPrimaryDisplay().workAreaSize
  pet = new BrowserWindow({
    width: 360,
    height: 520,
    x: Math.max(0, area.width - 380),
    y: Math.max(0, area.height - 540),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    title: 'agent2live Pet',
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  pet.setAlwaysOnTop(true, 'floating')
  pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  pet.setIgnoreMouseEvents(false)
  pet.once('ready-to-show', () => pet?.showInactive())
  pet.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  pet.webContents.on('will-navigate', (event) => event.preventDefault())
  pet.on('closed', () => {
    pet = null
    clickThrough = false
  })
  loadRenderer(pet, 'pet')
  return pet
}

export function getPetWindow(): BrowserWindow | null {
  return pet
}

export function getPetWindowState(): PetWindowState {
  const visible = Boolean(pet && !pet.isDestroyed() && pet.isVisible())
  return {
    visible,
    clickThrough,
    alwaysOnTop: Boolean(pet && !pet.isDestroyed() && pet.isAlwaysOnTop()),
    transparent: Boolean(pet && !pet.isDestroyed()) && PET_TRANSPARENT,
    focused: Boolean(pet && !pet.isDestroyed() && pet.isFocused())
  }
}

export function setPetClickThrough(enabled: boolean): PetWindowState {
  if (!pet || pet.isDestroyed()) throw new Error('pet window is not available')
  clickThrough = enabled
  pet.setIgnoreMouseEvents(enabled, { forward: true })
  return getPetWindowState()
}

export function getStudioWindow(): BrowserWindow | null {
  return studio
}
