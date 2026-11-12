import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'

it('reports runtime module ABI so native mismatches are observable', async () => {
  const app = buildApp({ token: 't' })
  try {
    const res = await app.inject({
      url: '/health',
      headers: { authorization: 'Bearer t' }
    })
    const body = res.json()
    expect(body.runtime.modules).toBe(process.versions.modules)
    expect(body.runtime.node).toBe(process.versions.node)
    expect(body.data.db).toBe(false)
  } finally {
    await app.close()
  }
})
