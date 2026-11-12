import pino, { type Logger, type LoggerOptions } from 'pino'
import type { DestinationStream } from 'pino'
import { getLogContext } from './context'

const SENSITIVE = new Set([
  'authorization',
  'apikey',
  'api_key',
  'secret',
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
      if (SENSITIVE.has(key.toLowerCase())) out[key] = '[REDACTED]'
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
      err: (error: Error & { code?: unknown }) => ({
        type: error.name,
        message: sanitizeLogText(error.message),
        ...(typeof error.code === 'string' ? { code: error.code } : {})
      })
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
