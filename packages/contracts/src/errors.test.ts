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

  it('registers Phase 1 domain errors with stable retry semantics', () => {
    const codes = [
      'PRECONDITION_REQUIRED',
      'IDEMPOTENCY_KEY_REQUIRED',
      'IDEMPOTENCY_KEY_REUSED',
      'CHARACTER_BRIEF_IMMUTABLE',
      'CHARACTER_BRIEF_NOT_FOUND',
      'CHARACTER_BRIEF_INPUT_CONFLICT',
      'CHARACTER_BRIEF_STALE',
      'ART_REFERENCE_SET_INVALID',
      'ART_REFERENCE_PRIMARY_REQUIRED',
      'ART_REFERENCE_ORDER_INVALID',
      'PROMPT_INPUT_EMPTY',
      'PROMPT_BASE_STALE',
      'PROMPT_BLOCK_LOCKED',
      'PROMPT_DRAFT_REQUIRED',
      'PROMPT_VERSION_IMMUTABLE',
      'PROMPT_REFERENCE_LIMIT',
      'PROMPT_LENGTH_EXCEEDS_LIMIT',
      'PROMPT_OPERATION_INVALID',
      'PROMPT_OPERATION_STALE',
      'PROMPT_BRIEF_PROJECTION_STALE',
      'PROMPT_REVERSE_INVALID_OUTPUT',
      'PROMPT_REVERSE_STALE',
      'PROMPT_REVERSE_RESOLVED',
      'PROMPT_SUGGESTION_INVALID_OUTPUT',
      'PROMPT_SUGGESTION_RESOLVED',
      'PROMPT_DRAFT_EXISTS',
      'PROMPT_INPUT_REQUIRED',
      'PROMPT_INPUT_MISMATCH',
      'PROMPT_REQUIREMENT_UNCOVERED',
      'PROMPT_VERSION_REQUIRED',
      'ART_ACTIVE_VERSION_CHANGED',
      'ART_VERSION_IMMUTABLE',
      'ART_IMAGE_INVALID',
      'FORK_BRANCH_CONFLICT',
      'FORK_SOURCE_UNCOMMITTED',
      'JOB_CANCEL_NOT_ALLOWED',
      'JOB_LEASE_LOST',
      'PROVIDER_NOT_CONFIGURED',
      'PROVIDER_CAPABILITY_UNSUPPORTED',
      'BACKUP_FAILED',
      'BACKUP_TOO_LARGE',
      'ASSET_INVALID',
      'ASSET_TOO_LARGE',
      'ASSET_NOT_FOUND',
      'PROJECT_HAS_ACTIVE_JOBS',
      'RESOURCE_DELETED',
      'ROW_VERSION_CONFLICT'
    ] as const
    for (const code of codes) {
      const definition = getErrorDefinition(code)
      expect(definition.code).toBe(code)
      expect(definition.detailsSchema).toBeDefined()
    }
    expect(getErrorDefinition('ART_ACTIVE_VERSION_CHANGED')).toMatchObject({
      httpStatus: 409,
      category: 'conflict',
      retryable: false,
      userAction: 'refresh_resource'
    })
    expect(getErrorDefinition('PROMPT_BLOCK_LOCKED')).toMatchObject({
      httpStatus: 423,
      category: 'conflict',
      retryable: false,
      userAction: 'unlock_block'
    })
    expect(getErrorDefinition('CHARACTER_BRIEF_IMMUTABLE')).toMatchObject({
      httpStatus: 409,
      category: 'conflict',
      retryable: false
    })
    expect(getErrorDefinition('ART_REFERENCE_SET_INVALID')).toMatchObject({
      httpStatus: 422,
      category: 'validation',
      retryable: false
    })
    expect(getErrorDefinition('JOB_CANCEL_NOT_ALLOWED')).toMatchObject({
      httpStatus: 409,
      category: 'conflict',
      retryable: false
    })
  })
})
