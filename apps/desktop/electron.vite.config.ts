import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          studio: resolve(__dirname, 'src/renderer/studio/index.html'),
          pet: resolve(__dirname, 'src/renderer/pet/index.html')
        }
      }
    }
  }
})
