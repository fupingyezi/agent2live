import { describe, expect, it } from 'vitest'
import { StaticSecretResolver } from '../src/services/secret-resolver'
import { BrokerSecretResolver, type BrokerPort } from '../src/services/broker-resolver'

describe('secret resolvers', () => {
  it('resolves references without exposing values in errors', async () => {
    const resolver = new StaticSecretResolver(new Map([['sec_01J00000000000000000000000', 'sk-test-value']]))
    await expect(resolver.resolve('sec_01J00000000000000000000000')).resolves.toBe('sk-test-value')
    await expect(resolver.resolve('sec_01J00000000000000000000001')).rejects.toMatchObject({
      code: 'PROVIDER_NOT_CONFIGURED'
    })
  })

  it('redacts a secret from provider errors', () => {
    const resolver = new StaticSecretResolver(new Map([['sec_01J00000000000000000000000', 'sk-test-value']]))
    expect(resolver.redact('boom sk-test-value')).toBe('boom [REDACTED]')
  })

  it('resolves through the broker and redacts the resolved value', async () => {
    let listener: (message: unknown) => void = () => {}
    const port: BrokerPort = {
      postMessage: (message) => {
        const { id } = message as { id: string }
        queueMicrotask(() => listener({ type: 'secret.response', id, value: 'sk-broker-value' }))
      },
      onMessage: (next) => {
        listener = next
      }
    }
    const resolver = new BrokerSecretResolver(port, 100)
    await expect(resolver.resolve('sec_01J00000000000000000000000')).resolves.toBe('sk-broker-value')
    expect(resolver.redact('boom sk-broker-value')).toBe('boom [REDACTED]')
  })

  it('fails closed when the main process does not answer', async () => {
    const resolver = new BrokerSecretResolver({ postMessage: () => {}, onMessage: () => {} }, 10)
    await expect(resolver.resolve('sec_01J00000000000000000000000')).rejects.toMatchObject({
      code: 'PROVIDER_NOT_CONFIGURED'
    })
  })
})
