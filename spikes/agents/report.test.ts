import { describe, expect, it } from 'vitest'
import { authSource, safeErrorCode, shortHash } from './lib/report'

describe('probe report helpers', () => {
  it('hashes identifiers without exposing them', () => {
    const hash = shortHash('thread-secret-id')
    expect(hash).toMatch(/^[a-f0-9]{16}$/)
    expect(hash).not.toContain('secret')
    expect(shortHash(null)).toBeNull()
  })

  it('reports only auth source names and stable error codes', () => {
    expect(authSource({ ANTHROPIC_API_KEY: 'sk-ant-secret' })).toBe('api_key')
    expect(authSource({ CLAUDE_CODE_OAUTH_TOKEN: 'oauth-secret' })).toBe('oauth_token')
    expect(authSource({})).toBeNull()
    expect(safeErrorCode(Object.assign(new Error('boom'), { code: 'PROVIDER_TIMEOUT' }))).toBe(
      'PROVIDER_TIMEOUT'
    )
    expect(safeErrorCode(new Error('secret path /Users/me'))).toBe('Error')
  })
})
