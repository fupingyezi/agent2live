import { expect, it } from 'vitest'
import { Writable } from 'node:stream'
import { createLogger, redactLogValue } from './logger'

function capture() {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk, _enc, callback) {
      lines.push(chunk.toString())
      callback()
    }
  })
  return { lines, stream }
}

it('redacts sensitive keys recursively', () => {
  const value = {
    authorization: 'Bearer top-secret',
    nested: { apiKey: 'sk-live-secret', keep: 'ok' },
    prompt: 'private prompt body',
    list: [{ token: 'tok' }]
  }
  const redacted = redactLogValue(value)
  expect(JSON.stringify(redacted)).not.toContain('top-secret')
  expect(JSON.stringify(redacted)).not.toContain('sk-live-secret')
  expect(JSON.stringify(redacted)).not.toContain('private prompt body')
  expect(redacted).toEqual({
    authorization: '[REDACTED]',
    nested: { apiKey: '[REDACTED]', keep: 'ok' },
    prompt: '[REDACTED]',
    list: [{ token: '[REDACTED]' }]
  })
})

it('writes structured JSON without leaked object fields', () => {
  const { lines, stream } = capture()
  const logger = createLogger({ level: 'info', destination: stream })
  logger.info({ authorization: 'Bearer secret', nested: { password: 'p@ss' }, ok: 1 }, 'health check')
  const entry = JSON.parse(lines.join(''))
  expect(entry.msg).toBe('health check')
  expect(entry.nested.password).toBe('[REDACTED]')
  expect(JSON.stringify(entry)).not.toContain('secret')
  expect(JSON.stringify(entry)).not.toContain('p@ss')
})

it('serializes errors without absolute paths or stack traces', () => {
  const { lines, stream } = capture()
  const logger = createLogger({ level: 'info', destination: stream })
  logger.error({ err: new Error('boom /Users/alice/private/secret.png') }, 'failed')
  const entry = JSON.parse(lines.join(''))
  expect(entry.err.message).toContain('boom')
  expect(JSON.stringify(entry)).not.toContain('/Users/alice')
  expect(entry.err.stack).toBeUndefined()
})

it('redacts secret keys after normalizing case and punctuation', () => {
  const redacted = redactLogValue({
    accessToken: 'a',
    refresh_token: 'b',
    'api-key': 'c',
    clientSecret: 'd',
    secretKey: 'e',
    privateKey: 'f',
    credential: 'g',
    nested: { clientSecret: 'h' },
    maxTokens: 42,
    keep: 'ok'
  })
  expect(redacted).toEqual({
    accessToken: '[REDACTED]',
    refresh_token: '[REDACTED]',
    'api-key': '[REDACTED]',
    clientSecret: '[REDACTED]',
    secretKey: '[REDACTED]',
    privateKey: '[REDACTED]',
    credential: '[REDACTED]',
    nested: { clientSecret: '[REDACTED]' },
    maxTokens: 42,
    keep: 'ok'
  })
})

it('sanitizes absolute user paths in plain string messages', () => {
  const { lines, stream } = capture()
  const logger = createLogger({ level: 'info', destination: stream })
  logger.info('loaded /Users/alice/private/model.png')
  const entry = JSON.parse(lines.join(''))
  expect(entry.msg).toBe('loaded [PATH]')
  expect(JSON.stringify(entry)).not.toContain('/Users/alice')
})

it('does not throw for non-Error err values and sanitizes their paths', () => {
  const { lines, stream } = capture()
  const logger = createLogger({ level: 'info', destination: stream })
  expect(() => logger.error({ err: 'failed /Users/alice/private/model.png' }, 'bad')).not.toThrow()
  const entry = JSON.parse(lines.join(''))
  expect(entry.err.message).toBe('failed [PATH]')
  expect(JSON.stringify(entry)).not.toContain('/Users/alice')
})

it('emits a safe placeholder for primitive non-string err values', () => {
  const { lines, stream } = capture()
  const logger = createLogger({ level: 'info', destination: stream })
  expect(() => logger.error({ err: 42 }, 'bad')).not.toThrow()
  const entry = JSON.parse(lines.join(''))
  expect(entry.err).toEqual({ message: '[REDACTED]' })
})

it('preserves the original error name in the err field', () => {
  const { lines, stream } = capture()
  const logger = createLogger({ level: 'info', destination: stream })
  logger.error({ err: new TypeError('nope') }, 'failed')
  const entry = JSON.parse(lines.join(''))
  expect(entry.err).toEqual({ type: 'TypeError', message: 'nope' })
  expect(entry.err.stack).toBeUndefined()
})
