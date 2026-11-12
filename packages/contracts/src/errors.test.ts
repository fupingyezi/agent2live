import { describe, expect, it } from 'vitest'
import { ERROR_REGISTRY, buildProblem, getErrorDefinition, problemDetailsSchema } from './errors'

const base = {
  requestId: 'req_01J0000000000000000000000',
  traceId: 'trc_01J0000000000000000000000',
  supportId: 'req_01J0000000000000000000000',
  instance: '/api/v1/health'
}

describe('error registry', () => {
  it('has a complete definition for every code', () => {
    for (const [key, def] of Object.entries(ERROR_REGISTRY)) {
      expect(def.code).toBe(key)
      expect(def.httpStatus).toBeGreaterThanOrEqual(400)
      expect(def.messageKey).toMatch(/^errors\./)
      expect(def.detailsSchema).toBeDefined()
      expect([
        'none',
        'fix_input',
        'reload',
        'refresh_resource',
        'unlock_block',
        'retry',
        'open_settings',
        'reauth',
        'choose_other',
        'contact_support'
      ]).toContain(def.userAction)
    }
  })

  it('builds RFC 9457-shaped problem details with stable fields', () => {
    const problem = buildProblem({
      ...base,
      code: 'RESOURCE_NOT_FOUND',
      detail: 'missing',
      details: { resource: 'character' }
    })
    expect(problem.schemaVersion).toBe('error/1')
    expect(problem.status).toBe(404)
    expect(problem.error.code).toBe('RESOURCE_NOT_FOUND')
    expect(problem.retryable).toBe(false)
    expect(problem.error.fieldErrors).toEqual([])
    expect(problemDetailsSchema.parse(problem)).toEqual(problem)
  })

  it('maps unknown codes to SYS_INTERNAL and never leaks supplied detail or details', () => {
    const problem = buildProblem({
      ...base,
      code: 'NOT_A_REAL_CODE',
      detail: 'sk-secret /Users/alice/private',
      details: { apiKey: 'sk-secret' }
    })
    expect(problem.status).toBe(500)
    expect(problem.error.code).toBe('SYS_INTERNAL')
    expect(JSON.stringify(problem)).not.toContain('sk-secret')
    expect(JSON.stringify(problem)).not.toContain('/Users/alice')
  })

  it('rejects details outside the registered whitelist', () => {
    expect(() =>
      buildProblem({
        ...base,
        code: 'RESOURCE_NOT_FOUND',
        details: { prompt: 'should not be serialized' }
      })
    ).toThrow(/details/i)
  })

  it('validates field errors and retry hints', () => {
    const problem = buildProblem({
      ...base,
      code: 'VALIDATION_FAILED',
      fieldErrors: [{ path: 'title', code: 'required', messageKey: 'validation.required' }],
      retryAfterMs: 1500
    })
    expect(problem.error.fieldErrors).toHaveLength(1)
    expect(problem.retryAfterMs).toBe(1500)
  })
})
