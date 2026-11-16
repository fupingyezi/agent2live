import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/app'
import { EventStore } from '../src/events/store'
import { createServices } from '../src/services/container'
import { StaticSecretResolver } from '../src/services/secret-resolver'
import { createTestDatabase } from './helpers/app'

const SERVICE_KEYS = [
  'artVersions',
  'assets',
  'audit',
  'backups',
  'blobs',
  'briefs',
  'characters',
  'drafts',
  'forks',
  'generations',
  'idempotency',
  'inputs',
  'jobs',
  'projectTree',
  'projects',
  'promptSync',
  'providerConnections',
  'providerInvocations',
  'providerProbes',
  'providerRegistry',
  'reverse',
  'secrets',
  'submissions',
  'suggestions',
  'versions',
  'withEvents'
] as const

describe('phase 1 production wiring', () => {
  it('constructs the complete container and registers every public route', async () => {
    const fixture = createTestDatabase()
    const events = new EventStore(fixture.db, () => fixture.clock.now())
    const services = createServices({
      db: fixture.db,
      dataDir: fixture.dataDir,
      events,
      clock: fixture.clock,
      secrets: new StaticSecretResolver(new Map()),
      workerId: 'wiring-test'
    })
    const app = buildApp({
      token: 'test-token-0123456789',
      dataDir: fixture.dataDir,
      db: fixture.db,
      eventStore: events,
      services
    })
    await app.ready()
    try {
      expect(Object.keys(services).sort()).toEqual([...SERVICE_KEYS])

      const routes: ReadonlyArray<readonly [string, string]> = [
        ['GET', '/api/v1/characters'],
        ['POST', '/api/v1/characters'],
        ['GET', '/api/v1/characters/:id'],
        ['PATCH', '/api/v1/characters/:id'],
        ['DELETE', '/api/v1/characters/:id'],
        ['GET', '/api/v1/characters/:id/brief-versions'],
        ['POST', '/api/v1/characters/:id/brief-versions'],
        ['POST', '/api/v1/characters/:id/art-projects'],
        ['GET', '/api/v1/art-projects/:id'],
        ['PATCH', '/api/v1/art-projects/:id'],
        ['DELETE', '/api/v1/art-projects/:id'],
        ['GET', '/api/v1/art-projects/:id/tree'],
        ['GET', '/api/v1/art-projects/tree'],
        ['POST', '/api/v1/assets'],
        ['GET', '/api/v1/assets/:id'],
        ['GET', '/api/v1/assets/:id/content'],
        ['GET', '/api/v1/providers'],
        ['GET', '/api/v1/providers/:id'],
        ['POST', '/api/v1/providers'],
        ['PATCH', '/api/v1/providers/:id'],
        ['POST', '/api/v1/providers/:id/test'],
        ['GET', '/api/v1/jobs/:id'],
        ['GET', '/api/v1/jobs/:id/events'],
        ['POST', '/api/v1/jobs/:id/cancel'],
        ['POST', '/api/v1/art-projects/:id/prompt-inputs'],
        ['POST', '/api/v1/art-projects/:id/prompt-drafts'],
        ['PATCH', '/api/v1/art-projects/:id/prompt-drafts/:draftId'],
        ['POST', '/api/v1/art-projects/:id/prompt-drafts/:draftId/commit'],
        ['GET', '/api/v1/art-projects/:id/prompt'],
        ['GET', '/api/v1/art-projects/:id/prompt-versions'],
        ['GET', '/api/v1/art-projects/:id/prompt-versions/:versionId'],
        ['POST', '/api/v1/art-projects/:id/prompt-reverse'],
        ['GET', '/api/v1/art-projects/:id/prompt-reverse-results'],
        ['GET', '/api/v1/prompt-reverse-results/:resultId'],
        ['POST', '/api/v1/prompt-reverse-results/:resultId/apply'],
        ['POST', '/api/v1/prompt-reverse-results/:resultId/discard'],
        ['POST', '/api/v1/prompt-versions/:versionId/suggestions'],
        ['POST', '/api/v1/art-projects/:id/prompt-drafts/:draftId/suggestions'],
        ['POST', '/api/v1/art-projects/:id/prompt-drafts/:draftId/sync'],
        ['GET', '/api/v1/prompt-suggestions/:suggestionId'],
        ['POST', '/api/v1/prompt-suggestions/:suggestionId/accept'],
        ['POST', '/api/v1/prompt-suggestions/:suggestionId/reject'],
        ['POST', '/api/v1/art-projects/:id/generations'],
        ['GET', '/api/v1/generations/:generationId'],
        ['GET', '/api/v1/art-projects/:id/art-versions'],
        ['GET', '/api/v1/art-projects/:id/art-versions/:versionId'],
        ['GET', '/api/v1/art-versions/:versionId/references'],
        ['POST', '/api/v1/art-projects/:id/art-versions/manual'],
        ['POST', '/api/v1/generation-candidates/:candidateId/accept'],
        ['POST', '/api/v1/art-projects/:id/art-versions/:versionId/activate'],
        ['POST', '/api/v1/art-versions/:versionId/reference-revisions'],
        ['POST', '/api/v1/prompt-versions/:versionId/forks'],
        ['POST', '/api/v1/art-versions/:versionId/forks'],
        ['PATCH', '/api/v1/art-projects/:id/fork-link'],
        ['POST', '/api/v1/characters/:id/backups'],
        ['GET', '/api/v1/characters/:id/backups'],
        ['GET', '/api/v1/backups/:backupId'],
        ['GET', '/api/v1/backups/:backupId/download']
      ]
      for (const [method, url] of routes) {
        expect(app.hasRoute({ method: method as 'GET', url }), `${method} ${url}`).toBe(true)
      }

      const auth = { authorization: 'Bearer test-token-0123456789' }
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/characters',
        headers: auth,
        payload: { title: '接线角色', summary: '生产容器装配测试' }
      })
      expect(created.statusCode).toBe(201)
      expect(created.json()).toMatchObject({ title: '接线角色' })

      const listed = await app.inject({
        method: 'GET',
        url: '/api/v1/characters',
        headers: auth
      })
      expect(listed.statusCode).toBe(200)
      expect(listed.json()).toMatchObject({ items: [{ title: '接线角色' }] })
    } finally {
      await services.jobs.stop()
      await app.close()
      fixture.db.close()
    }
  })
})
