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
