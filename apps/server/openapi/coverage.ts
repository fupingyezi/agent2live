import { buildApp } from '../src/app'
import type { EventStore } from '../src/events/store'
import type { Services } from '../src/services/container'

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
