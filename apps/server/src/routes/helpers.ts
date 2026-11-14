import type { FastifyRequest } from 'fastify'
import { AppError } from '../errors'
import type { RequestIds } from '../services/request-ids'

export function requireIdempotencyKey(request: FastifyRequest): string {
  const raw = request.headers['idempotency-key']
  const key = Array.isArray(raw) ? raw[0] : raw
  if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', {})
  }
  return key
}

export function idsOf(request: FastifyRequest): RequestIds {
  return { requestId: request.id, traceId: request.traceId }
}
