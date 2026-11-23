import { buildApp } from '../src/app'
import type { EventStore } from '../src/events/store'
import type { Services } from '../src/services/container'
import type { OperationSpec } from './manifest/types'

export interface RegisteredRoute {
  method: string
  path: string
}

export async function collectRegisteredRoutes(): Promise<RegisteredRoute[]> {
  const routes: RegisteredRoute[] = []
  const app = buildApp({
    token: 'openapi-coverage',
    services: {} as Services,
    eventStore: {} as unknown as EventStore,
    onRoute: (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method]
      for (const method of methods) {
        if (method === 'HEAD') continue
        // @fastify/cors registers a synthetic wildcard preflight route.
        if (method === 'OPTIONS' && route.url === '*') continue
        routes.push({ method, path: route.url })
      }
    }
  })
  await app.ready()
  await app.close()
  return routes
}

export function normalizeOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
}

export function assertManifestCoverage(manifest: OperationSpec[], routes: RegisteredRoute[]): void {
  const toKey = (method: string, path: string): string => `${method} ${normalizeOpenApiPath(path)}`
  const expected = new Set(manifest.map((operation) => toKey(operation.method, operation.path)))
  const actual = new Set(routes.map((route) => toKey(route.method, route.path)))
  const missing = [...expected].filter((key) => !actual.has(key))
  const extra = [...actual].filter((key) => !expected.has(key))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`route coverage mismatch; missing=[${missing.join(', ')}]; extra=[${extra.join(', ')}]`)
  }
}
