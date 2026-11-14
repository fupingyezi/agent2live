import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AppError, problemFor } from '../src/errors'
import { toAppError } from '../src/http/errors'
import { MAX_IMAGE_BYTES } from '../src/images/validate'
import { createTestApp } from './helpers/app'

const requestIds = { requestId: 'req_test', traceId: 'trc_test', instance: '/api/v1/characters' }

function zodFailure(): unknown {
  try {
    z.object({ name: z.string() }).strict().parse({ name: 1, secret: 'sk-very-secret' })
  } catch (error) {
    return error
  }
  throw new Error('expected Zod parse failure')
}

describe('toAppError', () => {
  it('maps Zod errors to REQUEST_INVALID without leaking values', () => {
    const mapped = toAppError(zodFailure())
    expect(mapped).toBeInstanceOf(AppError)
    expect(mapped.code).toBe('REQUEST_INVALID')
    expect(mapped.details).toMatchObject({
      issues: expect.arrayContaining([
        { path: 'name', code: 'invalid_type' },
        { path: '', code: 'unrecognized_keys' }
      ])
    })
    expect(JSON.stringify(mapped.details)).not.toContain('sk-very-secret')
  })

  it('hides internal error details and defaults the support id to the request id', () => {
    const problem = problemFor(toAppError(new Error('boom sk-very-secret /Users/alice/private')), requestIds)
    expect(problem).toMatchObject({ status: 500, error: { code: 'SYS_INTERNAL' } })
    expect(problem.supportId).toBe(requestIds.requestId)
    expect(JSON.stringify(problem)).not.toContain('sk-very-secret')
    expect(JSON.stringify(problem)).not.toContain('/Users/alice')
  })

  it('maps Fastify client request errors', () => {
    const validation = Object.assign(new Error('bad request'), {
      code: 'FST_ERR_VALIDATION',
      validation: [{ instancePath: '/title', keyword: 'minLength' }]
    })
    expect(toAppError(validation)).toMatchObject({ code: 'REQUEST_INVALID' })

    for (const code of ['FST_ERR_CTP_INVALID_JSON_BODY', 'FST_ERR_CTP_BODY_TOO_LARGE']) {
      expect(toAppError(Object.assign(new Error('bad body'), { code }))).toMatchObject({
        code: 'REQUEST_INVALID'
      })
    }

    const tooLarge = toAppError(Object.assign(new Error('too large'), { code: 'FST_REQ_FILE_TOO_LARGE' }))
    expect(tooLarge.code).toBe('ASSET_TOO_LARGE')
    expect(tooLarge.details).toEqual({ bytes: 0, limit: MAX_IMAGE_BYTES })
  })

  it('guards non-object thrown values and preserves AppError instances', () => {
    const original = new AppError('RESOURCE_NOT_FOUND', { resource: 'character' })
    expect(toAppError(original)).toBe(original)
    expect(toAppError('boom').code).toBe('SYS_INTERNAL')
    expect(toAppError(null).code).toBe('SYS_INTERNAL')
    expect(toAppError(undefined).code).toBe('SYS_INTERNAL')
    expect(toAppError(42).code).toBe('SYS_INTERNAL')
  })

  it('returns bounded issues for schema violations without echoing values', async () => {
    const ctx = await createTestApp()
    try {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/characters',
        headers: ctx.auth,
        payload: { title: 42, secret: 'sk-very-secret' }
      })
      expect(response.statusCode).toBe(400)
      const problem = response.json<{
        error: { code: string; details: { issues: Array<{ path: string; code: string }> } }
      }>()
      expect(problem.error.code).toBe('REQUEST_INVALID')
      expect(problem.error.details.issues).toEqual(
        expect.arrayContaining([
          { path: 'title', code: 'invalid_type' },
          { path: '', code: 'unrecognized_keys' }
        ])
      )
      expect(JSON.stringify(problem)).not.toContain('sk-very-secret')
    } finally {
      await ctx.close()
    }
  })

  it('returns problem+json for malformed JSON request bodies', async () => {
    const ctx = await createTestApp()
    try {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/characters',
        headers: { ...ctx.auth, 'content-type': 'application/json' },
        payload: '{"title":'
      })
      expect(response.statusCode).toBe(400)
      expect(response.headers['content-type']).toContain('application/problem+json')
      const problem = response.json<{ status: number; error: { code: string } }>()
      expect(problem).toMatchObject({ status: 400, error: { code: 'REQUEST_INVALID' } })
      expect(JSON.stringify(problem)).not.toContain('{"title":')
    } finally {
      await ctx.close()
    }
  })
})
