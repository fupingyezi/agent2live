import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const desktopSharedAlias = {
  '@desktop/shared': resolve(__dirname, 'src/shared')
}

const rendererAliases = {
  ...desktopSharedAlias,
  '@renderer': resolve(__dirname, 'src/renderer'),
  '@studio': resolve(__dirname, 'src/renderer/studio')
}

export default defineConfig({
  main: {
    resolve: {
      alias: desktopSharedAlias
    },
    build: {
      // Bundle workspace-protocol modules into out/main: they only exist in the
      // workspace during development, not in the packaged app's node_modules.
      // (contracts ships TypeScript source; the preload only imports its types.)
      externalizeDeps: { exclude: ['@agent2live/live2d-runtime', '@agent2live/contracts'] }
    }
  },
  preload: {
    resolve: {
      alias: desktopSharedAlias
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: rendererAliases
    },
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
