import { describe, expect, test } from 'vitest'
import { parseEnvFile, resolveEnvValue } from './env-file'

describe('parseEnvFile', () => {
  test('parses KEY=VALUE pairs', () => {
    expect(parseEnvFile('AGENT2LIVE_PORT=3000\nOTHER=x')).toEqual({
      AGENT2LIVE_PORT: '3000',
      OTHER: 'x'
    })
  })

  test('skips comments, blank lines and malformed lines', () => {
    expect(parseEnvFile('# note\n\n   \nNODASH\nKEY=v')).toEqual({ KEY: 'v' })
  })

  test('handles CRLF line endings', () => {
    expect(parseEnvFile('A=1\r\nB=2\r\n')).toEqual({ A: '1', B: '2' })
  })

  test('strips matching surrounding quotes', () => {
    expect(parseEnvFile('A="1 2"\nB=\'3\'\nC="unmatched')).toEqual({
      A: '1 2',
      B: '3',
      C: '"unmatched'
    })
  })

  test('trims whitespace and keeps value after the first =', () => {
    expect(parseEnvFile('  A  =  b=c  ')).toEqual({ A: 'b=c' })
  })

  test('keeps empty values', () => {
    expect(parseEnvFile('A=')).toEqual({ A: '' })
  })
})

describe('resolveEnvValue', () => {
  const io = {
    existsSync: (path: string) => path === '/first/.env',
    readFileSync: (path: string) => {
      if (path === '/first/.env') return 'PORT=1111\nOTHER=x'
      throw new Error('unexpected read: ' + path)
    }
  }

  test('reads the first existing candidate', () => {
    expect(resolveEnvValue(['/missing/.env', '/first/.env'], 'PORT', io)).toBe('1111')
  })

  test('returns null when the key is absent', () => {
    expect(resolveEnvValue(['/first/.env'], 'MISSING', io)).toBeNull()
  })

  test('returns null when no candidate exists', () => {
    expect(resolveEnvValue(['/missing/.env'], 'PORT', io)).toBeNull()
  })

  test('returns null when the file cannot be read', () => {
    const throwingIo = {
      existsSync: () => true,
      readFileSync: () => {
        throw new Error('boom')
      }
    }
    expect(resolveEnvValue(['/any/.env'], 'PORT', throwingIo)).toBeNull()
  })
})
