import { describe, expect, it } from 'vitest'
import { createTestApp } from './helpers/app'

describe('characters and projects', () => {
  it('creates a character, project, and lists the tree with CAS updates', async () => {
    const ctx = await createTestApp()
    try {
      const characterRes = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/characters',
        headers: ctx.auth,
        payload: { title: '凛', summary: '银发蓝眼' }
      })
      expect(characterRes.statusCode).toBe(201)
      const character = characterRes.json<{ id: string; rowVersion: number }>()
      expect(character.id).toMatch(/^chr_/)

      const projectRes = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/characters/${character.id}/art-projects`,
        headers: ctx.auth,
        payload: { title: '初始立绘', description: '半身像' }
      })
      expect(projectRes.statusCode).toBe(201)
      const project = projectRes.json<{
        id: string
        characterId: string
        stage: string
        rowVersion: number
      }>()
      expect(project).toMatchObject({ characterId: character.id, stage: 'idea_draft' })

      const tree = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/art-projects/${project.id}/tree`,
        headers: ctx.auth
      })
      expect(tree.statusCode).toBe(200)
      expect(tree.json()).toMatchObject({ root: { id: project.id }, children: [], forks: [] })

      const patched = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/characters/${character.id}`,
        headers: { ...ctx.auth, 'if-match': `"${character.rowVersion}"` },
        payload: { title: '凛·改' }
      })
      expect(patched.statusCode).toBe(200)
      expect(patched.json()).toMatchObject({ title: '凛·改', rowVersion: character.rowVersion + 1 })
    } finally {
      await ctx.close()
    }
  })

  it('creates immutable character brief versions and moves the active pointer with CAS', async () => {
    const ctx = await createTestApp()
    try {
      const character = (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/characters',
          headers: ctx.auth,
          payload: { title: '霜' }
        })
      ).json<{ id: string; activeBriefVersionId: string | null }>()
      expect(character.activeBriefVersionId).toBeNull()

      const first = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/characters/${character.id}/brief-versions`,
        headers: ctx.auth,
        payload: {
          content: {
            schemaVersion: 'character-brief/1',
            identity: { fullName: '檐上霜' },
            background: { summary: '旧城屋檐上的铸剑师' }
          }
        }
      })
      expect(first.statusCode).toBe(201)
      const v1 = first.json<{ id: string; contentHash: string; parentVersionId: string | null }>()
      expect(v1.id).toMatch(/^cbv_/)
      expect(v1.parentVersionId).toBeNull()

      const active = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/characters/${character.id}`,
        headers: ctx.auth
      })
      expect(active.json()).toMatchObject({ activeBriefVersionId: v1.id })

      ctx.clock.advance(1)
      const second = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/characters/${character.id}/brief-versions`,
        headers: ctx.auth,
        payload: {
          content: {
            schemaVersion: 'character-brief/1',
            identity: { fullName: '檐上霜' },
            appearance: { defaultPose: '正面站姿' }
          },
          parentVersionId: v1.id,
          expectedActiveBriefVersionId: v1.id
        }
      })
      expect(second.statusCode).toBe(201)
      expect(second.json()).toMatchObject({ parentVersionId: v1.id })

      const list = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/characters/${character.id}/brief-versions`,
        headers: ctx.auth
      })
      expect(list.json()).toMatchObject({
        activeVersionId: second.json<{ id: string }>().id,
        items: [{ parentVersionId: v1.id }, { parentVersionId: null }]
      })

      const stale = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/characters/${character.id}/brief-versions`,
        headers: ctx.auth,
        payload: {
          content: { schemaVersion: 'character-brief/1', notes: '新笔记' },
          expectedActiveBriefVersionId: null
        }
      })
      expect(stale.statusCode).toBe(409)
      expect(stale.json()).toMatchObject({ error: { code: 'CHARACTER_BRIEF_STALE' } })
    } finally {
      await ctx.close()
    }
  })

  it('rejects a brief version from another character as parent', async () => {
    const ctx = await createTestApp()
    try {
      const a = (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/characters',
          headers: ctx.auth,
          payload: { title: 'A' }
        })
      ).json<{ id: string }>()
      const b = (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/characters',
          headers: ctx.auth,
          payload: { title: 'B' }
        })
      ).json<{ id: string }>()
      const brief = (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/v1/characters/${a.id}/brief-versions`,
          headers: ctx.auth,
          payload: { content: { schemaVersion: 'character-brief/1', notes: 'A 的设定' } }
        })
      ).json<{ id: string }>()
      const cross = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/characters/${b.id}/brief-versions`,
        headers: ctx.auth,
        payload: {
          content: { schemaVersion: 'character-brief/1', notes: 'B 的设定' },
          parentVersionId: brief.id
        }
      })
      expect(cross.statusCode).toBe(404)
      expect(cross.json()).toMatchObject({ error: { code: 'CHARACTER_BRIEF_NOT_FOUND' } })
    } finally {
      await ctx.close()
    }
  })

  it('soft deletes and blocks writes to deleted projects', async () => {
    const ctx = await createTestApp()
    try {
      const character = (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/characters',
          headers: ctx.auth,
          payload: { title: 'A' }
        })
      ).json<{ id: string }>()
      const project = (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/v1/characters/${character.id}/art-projects`,
          headers: ctx.auth,
          payload: { title: 'P' }
        })
      ).json<{ id: string; rowVersion: number }>()
      const deleted = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/art-projects/${project.id}`,
        headers: { ...ctx.auth, 'if-match': `"${project.rowVersion}"` }
      })
      expect(deleted.statusCode).toBe(204)
      const gone = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/art-projects/${project.id}`,
        headers: ctx.auth
      })
      expect(gone.statusCode).toBe(410)
      expect(gone.json()).toMatchObject({ error: { code: 'RESOURCE_DELETED' } })
      const write = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/art-projects/${project.id}`,
        headers: { ...ctx.auth, 'if-match': `"${project.rowVersion + 1}"` },
        payload: { title: 'x' }
      })
      expect(write.statusCode).toBe(410)
    } finally {
      await ctx.close()
    }
  })

  it('rejects unauthenticated reads, stale CAS writes, and audits mutations', async () => {
    const ctx = await createTestApp()
    try {
      const unauthorized = await ctx.app.inject({ method: 'GET', url: '/api/v1/characters' })
      expect(unauthorized.statusCode).toBe(401)
      expect(unauthorized.json()).toMatchObject({ error: { code: 'AUTH_LOCAL_TOKEN_INVALID' } })

      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/characters',
        headers: ctx.auth,
        payload: { title: 'B' }
      })
      const character = created.json<{ id: string; rowVersion: number }>()
      const updated = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/characters/${character.id}`,
        headers: { ...ctx.auth, 'if-match': `"${character.rowVersion}"` },
        payload: { title: 'B2' }
      })
      expect(updated.statusCode).toBe(200)
      expect(updated.headers.etag).toBe('"2"')

      const stale = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/characters/${character.id}`,
        headers: { ...ctx.auth, 'if-match': `"${character.rowVersion}"` },
        payload: { title: 'B3' }
      })
      expect(stale.statusCode).toBe(409)
      expect(stale.json()).toMatchObject({ error: { code: 'ROW_VERSION_CONFLICT' } })

      const project = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/characters/${character.id}/art-projects`,
        headers: ctx.auth,
        payload: { title: 'P' }
      })
      expect(project.statusCode).toBe(201)

      const actions = ctx.db
        .prepare('select action from audit_events order by at asc, rowid asc')
        .all() as Array<{ action: string }>
      expect(actions.map((row) => row.action)).toEqual(
        expect.arrayContaining(['character.created', 'character.updated', 'project.created'])
      )
    } finally {
      await ctx.close()
    }
  })

  it('cascades character deletion to all of its live projects', async () => {
    const ctx = await createTestApp()
    try {
      const character = (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/characters',
          headers: ctx.auth,
          payload: { title: 'C' }
        })
      ).json<{ id: string }>()
      const projectIds: string[] = []
      for (const title of ['P1', 'P2']) {
        const project = await ctx.app.inject({
          method: 'POST',
          url: `/api/v1/characters/${character.id}/art-projects`,
          headers: ctx.auth,
          payload: { title }
        })
        expect(project.statusCode).toBe(201)
        projectIds.push(project.json<{ id: string }>().id)
      }

      const deleted = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/characters/${character.id}`,
        headers: { ...ctx.auth, 'if-match': '"1"' }
      })
      expect(deleted.statusCode).toBe(204)

      const characterAfter = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/characters/${character.id}`,
        headers: ctx.auth
      })
      expect(characterAfter.statusCode).toBe(410)
      expect(characterAfter.json()).toMatchObject({
        error: { code: 'RESOURCE_DELETED', details: { resource: 'character' } }
      })

      for (const projectId of projectIds) {
        const projectAfter = await ctx.app.inject({
          method: 'GET',
          url: `/api/v1/art-projects/${projectId}`,
          headers: ctx.auth
        })
        expect(projectAfter.statusCode).toBe(410)
        expect(projectAfter.json()).toMatchObject({
          error: { code: 'RESOURCE_DELETED', details: { resource: 'artProject' } }
        })
      }

      const projectDeletedEvents = ctx.db
        .prepare("select scope_id from event_log where type = 'project.deleted' order by seq asc")
        .all() as Array<{ scope_id: string }>
      expect(projectDeletedEvents.map((row) => row.scope_id).sort()).toEqual([...projectIds].sort())

      const characterEvents = ctx.db
        .prepare("select count(*) as count from event_log where type = 'character.deleted'")
        .get() as { count: number }
      expect(characterEvents.count).toBe(1)

      const actions = ctx.db
        .prepare('select action from audit_events order by at asc, rowid asc')
        .all() as Array<{ action: string }>
      expect(actions.map((row) => row.action)).toEqual(
        expect.arrayContaining(['project.deleted', 'project.deleted', 'character.deleted'])
      )
    } finally {
      await ctx.close()
    }
  })

  it('refuses to delete a project while a job still references it', async () => {
    const ctx = await createTestApp()
    try {
      const character = (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/characters',
          headers: ctx.auth,
          payload: { title: 'D' }
        })
      ).json<{ id: string }>()
      const project = (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/v1/characters/${character.id}/art-projects`,
          headers: ctx.auth,
          payload: { title: 'P' }
        })
      ).json<{ id: string }>()
      const now = ctx.clock.now()
      ctx.db
        .prepare(
          `insert into jobs
           (id, type, status, payload_json, payload_hash, attempts, max_attempts, side_effect, created_at, updated_at)
           values (?, ?, ?, ?, ?, 0, 3, 'idempotent', ?, ?)`
        )
        .run(
          'job_01J00000000000000000000000',
          'test.echo',
          'waiting_user',
          JSON.stringify({ artProjectId: project.id }),
          'a'.repeat(64),
          now,
          now
        )

      const blocked = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/art-projects/${project.id}`,
        headers: { ...ctx.auth, 'if-match': '"1"' }
      })
      expect(blocked.statusCode).toBe(409)
      expect(blocked.json()).toMatchObject({
        error: { code: 'PROJECT_HAS_ACTIVE_JOBS', details: { jobIds: ['job_01J00000000000000000000000'] } }
      })

      ctx.db
        .prepare("update jobs set status = 'succeeded' where id = ?")
        .run('job_01J00000000000000000000000')
      const deleted = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/art-projects/${project.id}`,
        headers: { ...ctx.auth, 'if-match': '"1"' }
      })
      expect(deleted.statusCode).toBe(204)
    } finally {
      await ctx.close()
    }
  })
})
