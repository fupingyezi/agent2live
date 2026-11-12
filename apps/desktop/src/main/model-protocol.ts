import { protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import { contentTypeFor, modelPathFromUrl, resolveContainedFile } from '@agent2live/live2d-runtime/protocol'

const MODEL_SCHEME = 'agent2live-model'

export function registerModelScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MODEL_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    }
  ])
}

export function registerModelProtocol(getRoot: () => string | null): void {
  protocol.handle(MODEL_SCHEME, async (request) => {
    try {
      const root = getRoot()
      if (!root) return new Response('model root not configured', { status: 404 })
      const path = modelPathFromUrl(request.url)
      if (!path) return new Response('not found', { status: 404 })
      const file = resolveContainedFile(root, path)
      if (!file) return new Response('not found', { status: 404 })
      const type = contentTypeFor(file)
      if (!type) return new Response('unsupported media type', { status: 415 })
      try {
        const bytes = await readFile(file)
        return new Response(bytes, {
          status: 200,
          headers: {
            'content-type': type,
            'cache-control': 'no-store',
            'access-control-allow-origin': '*'
          }
        })
      } catch {
        return new Response('not found', { status: 404 })
      }
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}
