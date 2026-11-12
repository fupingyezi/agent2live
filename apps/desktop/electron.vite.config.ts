import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    build: {
      // Bundle the workspace protocol module into out/main: it only exists in the
      // workspace during development, not in the packaged app's node_modules.
      externalizeDeps: { exclude: ['@agent2live/live2d-runtime'] }
    }
  },
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
