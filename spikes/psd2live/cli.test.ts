import { describe, expect, it } from 'vitest'
import { buildGradleEnv } from './lib/env'

describe('Gradle child environment', () => {
  it('strips MCP credentials and does not mutate the source environment', () => {
    const source = {
      PATH: '/usr/bin',
      JAVA_HOME: '/jdk21',
      PSD2LIVE_MCP_TOKEN: 'secret-token',
      PSD2LIVE_MCP_URL: 'http://127.0.0.1:23871/mcp?token=secret-token'
    }

    const env = buildGradleEnv(source)

    expect(env).toEqual({ PATH: '/usr/bin', JAVA_HOME: '/jdk21' })
    expect(JSON.stringify(env)).not.toContain('secret-token')
    expect(source.PSD2LIVE_MCP_TOKEN).toBe('secret-token')
  })
})
