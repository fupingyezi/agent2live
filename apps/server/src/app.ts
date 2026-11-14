import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import type Database from 'better-sqlite3'
import { newId } from '@agent2live/contracts'
import { createLogger } from '@agent2live/logging'
import { bearerToken, tokenMatches } from './auth'
import { latestMigrationVersion } from './db/migrate'
import { AppError, problemFor } from './errors'
import { openEventStream } from './events/sse'
import { EventStore } from './events/store'
import { apiJsonSerializer } from './http/api-json'
import { toAppError } from './http/errors'
import { registerArtVersionRoutes } from './routes/art-versions'
import { registerAssetRoutes } from './routes/assets'
import { registerBackupRoutes } from './routes/backups'
import { registerCharacterRoutes } from './routes/characters'
import { registerForkRoutes } from './routes/forks'
import { registerGenerationRoutes } from './routes/generations'
import { registerJobRoutes } from './routes/jobs'
import { registerMultipart } from './routes/multipart'
import { registerProjectRoutes } from './routes/projects'
import { registerPromptRoutes } from './routes/prompt'
import { registerPromptReverseRoutes } from './routes/prompt-reverse'
import { registerPromptSuggestionRoutes } from './routes/prompt-suggestions'
import { registerProviderRoutes } from './routes/providers'
import type { Services } from './services/container'

export interface AppOptions {
  token: string
  dataDir?: string
  db?: Database.Database
  eventStore?: EventStore
  services?: Services
}

declare module 'fastify' {
  interface FastifyRequest {
    traceId: string
  }
  interface FastifyInstance {
    eventStore: EventStore | null
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
  // API JSON is the only HTTP boundary that converts domain milliseconds to RFC 3339.
  // SSE frames bypass this serializer because they are written to the hijacked raw stream.
  app.setReplySerializer(apiJsonSerializer)

  void app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || origin === 'null' || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
        callback(null, true)
      } else {
        callback(new Error('origin not allowed'), false)
      }
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'if-match', 'idempotency-key', 'last-event-id'],
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

  const eventStore = options.eventStore ?? (options.db ? new EventStore(options.db) : null)
  app.decorate('eventStore', eventStore)

  app.get('/health', async () => {
    const body: Record<string, unknown> = {
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
      data: { db: Boolean(options.db), events: Boolean(eventStore) }
    }
    if (options.db) {
      body.db = {
        schemaVersion: 'sqlite/1',
        migration: latestMigrationVersion(options.db),
        wal: options.db.pragma('journal_mode', { simple: true }) === 'wal',
        vectorDim: 768
      }
    }
    return body
  })

  if (eventStore) {
    app.get('/api/v1/events', async (request, reply) => {
      openEventStream(request, reply, eventStore)
    })
  }

  // All domain routes live in a single root plugin so multipart is registered
  // exactly once and `request.parts()` stays decorated across route groups.
  const services = options.services
  if (services) {
    app.register(async (scope) => {
      await registerMultipart(scope)
      registerAssetRoutes(scope, services.assets)
      registerPromptRoutes(scope, {
        inputs: services.inputs,
        drafts: services.drafts,
        versions: services.versions,
        idempotency: services.idempotency
      })
      registerCharacterRoutes(scope, {
        characters: services.characters,
        characterBriefs: services.briefs,
        projects: services.projects
      })
      registerProjectRoutes(scope, {
        projects: services.projects,
        projectTree: services.projectTree
      })
      registerProviderRoutes(scope, {
        connections: services.providerConnections,
        secrets: services.secrets,
        idempotency: services.idempotency
      })
      registerJobRoutes(scope, services.jobs)
      registerPromptReverseRoutes(scope, {
        promptReverse: services.reverse,
        jobs: services.jobs
      })
      registerPromptSuggestionRoutes(scope, {
        promptSuggestions: services.suggestions,
        jobs: services.jobs
      })
      registerGenerationRoutes(scope, {
        generations: services.generations,
        jobs: services.jobs,
        idempotency: services.idempotency
      })
      registerArtVersionRoutes(scope, {
        artVersions: services.artVersions,
        idempotency: services.idempotency
      })
      registerForkRoutes(scope, {
        forks: services.forks,
        idempotency: services.idempotency
      })
      registerBackupRoutes(scope, {
        backups: services.backups,
        jobs: services.jobs,
        idempotency: services.idempotency
      })
    })
  }

  app.setNotFoundHandler((request, _reply) => {
    throw new AppError('RESOURCE_NOT_FOUND', { resource: request.url.split('?')[0] })
  })

  app.setErrorHandler((error, request, reply) => {
    const appError = toAppError(error)
    const problem = problemFor(appError, {
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
