import type { EventRecord } from './store'

export function formatSseFrame(event: EventRecord): string {
  const data = {
    schemaVersion: 'event/1',
    seq: event.seq,
    type: event.type,
    scope: { kind: event.scopeKind, id: event.scopeId },
    payload: event.payload,
    requestId: event.requestId,
    traceId: event.traceId,
    createdAt: event.createdAt
  }
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`
}
