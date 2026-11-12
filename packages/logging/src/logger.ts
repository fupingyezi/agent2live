import pino, { type Logger, type LoggerOptions } from 'pino'
import type { DestinationStream } from 'pino'
import { getLogContext } from './context'

const SENSITIVE = new Set([
  'authorization',
  'apikey',
  'secret',
  'secretkey',
  'token',
  'password',
  'prompt',
  'prompttext',
  'messages',
  'message',
  'transcript',
  'diff',
  'command',
  'cmd',
  'body'
])

const SENSITIVE_KEY_SUFFIXES = [
  'token',
  'secret',
  'password',
  'credential',
  'apikey',
  'privatekey',
  'authorization'
]

function normalizeLogKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isSensitiveLogKey(key: string): boolean {
  const normalized = normalizeLogKey(key)
  return SENSITIVE.has(normalized) || SENSITIVE_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
}

export function redactLogValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED]'
  if (value instanceof Error) {
    return {
      type: value.name,
      message: sanitizeLogText(value.message),
      ...('code' in value && typeof value.code === 'string' ? { code: value.code } : {})
    }
  }
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveLogKey(key)) out[key] = '[REDACTED]'
      else out[key] = redactLogValue(item, depth + 1)
    }
    return out
  }
  return typeof value === 'string' ? sanitizeLogText(value) : value
}

export function sanitizeLogText(value: string): string {
  return value
    .replace(/\/Users\/[^/\s"']+(?:\/[^\s"']*)?/g, '[PATH]')
    .replace(/\/private\/(?:tmp|var|etc)\/[^\s"']*/g, '[PATH]')
}

function serializeLogError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      type: error.name,
      message: sanitizeLogText(error.message),
      ...('code' in error && typeof error.code === 'string' ? { code: error.code } : {})
    }
  }
  if (typeof error === 'string') {
    return { message: sanitizeLogText(error) }
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    let type: string | undefined
    if (typeof record.type === 'string') type = record.type
    else if (typeof record.name === 'string') type = record.name
    const message = typeof record.message === 'string' ? sanitizeLogText(record.message) : undefined
    const code = typeof record.code === 'string' ? record.code : undefined
    if (type === undefined && message === undefined && code === undefined) {
      return { message: '[REDACTED]' }
    }
    return {
      ...(type !== undefined ? { type } : {}),
      ...(message !== undefined ? { message } : {}),
      ...(code !== undefined ? { code } : {})
    }
  }
  return { message: '[REDACTED]' }
}

export interface CreateLoggerOptions {
  level?: string
  destination?: DestinationStream
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const opts: LoggerOptions = {
    level: options.level ?? 'info',
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    serializers: {
      err: serializeLogError
    },
    hooks: {
      logMethod(args, method) {
        const safe = args.map((arg) => {
          if (arg instanceof Error) {
            return {
              type: arg.name,
              message: sanitizeLogText(arg.message),
              ...('code' in arg && typeof arg.code === 'string' ? { code: arg.code } : {})
            }
          }
          if (typeof arg === 'string') return sanitizeLogText(arg)
          if (arg && typeof arg === 'object') return redactLogValue(arg)
          return arg
        })
        method.apply(this, safe as Parameters<typeof method>)
      }
    }
  }
  const logger = options.destination ? pino(opts, options.destination) : pino(opts)
  const context = getLogContext()
  return context ? logger.child(context) : logger
}
