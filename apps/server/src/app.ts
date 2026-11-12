import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import { newId } from '@agent2live/contracts'
import { createLogger } from '@agent2live/logging'
import { bearerToken, tokenMatches } from './auth'
import { AppError, problemFor } from './errors'

export interface AppOptions {
  token: string
  dataDir?: string
  db?: unknown
  events?: unknown
}

declare module 'fastify' {
  interface FastifyRequest {
    traceId: string
  }
}

const log = createLogger({ level: process.env.LOG_LEVEL ?? 'info' })

export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({
    logger: false,
    genReqId: () => newId('request'),
    bodyLimit: 32 * 1024 * 1024
  })

  app.decorateRequest('traceId', '')

  void app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || origin === 'null' || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
        callback(null, true)
      } else {
        callback(new Error('origin not allowed'), false)
      }
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'if-match', 'idempotency-key'],
    maxAge: 600
  })

  app.addHook('onRequest', async (request, reply) => {
    request.traceId = newId('trace')
    reply.header('x-request-id', request.id)
    reply.header('x-trace-id', request.traceId)
    reply.header('cache-control', 'no-store')
    if (request.method === 'OPTIONS') return
    const supplied = bearerToken(request.headers.authorization)
    if (!supplied || !tokenMatches(options.token, supplied)) {
      throw new AppError('AUTH_LOCAL_TOKEN_INVALID')
    }
  })

  app.addHook('onResponse', async (request, reply) => {
    log.info(
      {
        method: request.method,
        url: request.url.split('?')[0],
        status: reply.statusCode,
        requestId: request.id,
        traceId: request.traceId
      },
      'request completed'
    )
  })

  app.get('/health', async () => ({
    schemaVersion: 'health/1',
    ok: true,
    pid: process.pid,
    uptimeMs: Math.round(process.uptime() * 1000),
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    runtime: {
      node: process.versions.node,
      modules: process.versions.modules,
      electron: process.versions.electron ?? null
    },
    data: { db: Boolean(options.db), events: Boolean(options.events) }
  }))

  app.setNotFoundHandler((request, _reply) => {
    throw new AppError('RESOURCE_NOT_FOUND', { resource: request.url.split('?')[0] })
  })

  app.setErrorHandler((error, request, reply) => {
    const problem = problemFor(error, {
      requestId: request.id,
      traceId: request.traceId,
      instance: request.url
    })
    if (problem.status >= 500) {
      log.error({ err: error, requestId: request.id, traceId: request.traceId }, 'request failed')
    }
    void reply.status(problem.status).type('application/problem+json').send(problem)
  })

  return app
}
