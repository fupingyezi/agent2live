import { z } from 'zod'
import { json, sse, type OperationSpec } from './types'

const eventsQuerySchema = z.object({
  after: z.coerce.number().int().min(0).optional()
})

export const systemOperations: OperationSpec[] = [
  {
    group: 'system',
    method: 'GET',
    path: '/health',
    operationId: 'system.health',
    tag: '系统',
    summary: '本地服务健康状态',
    responses: { 200: json('HealthResponse') }
  },
  {
    group: 'system',
    method: 'GET',
    path: '/api/v1/events',
    operationId: 'events.stream',
    tag: '事件',
    summary: '订阅服务端事件流',
    description: 'SSE 帧的 data 是 JSON 字符串；createdAt 是 number，绕过 reply serializer。',
    query: eventsQuerySchema,
    responses: {
      200: sse(
        'Server-Sent Events；data 为 event/1 JSON 字符串',
        'id: 1\nevent: character.created\ndata: {"schemaVersion":"event/1","seq":1,"type":"character.created","scope":{"kind":"character","id":"chr_01J00000000000000000000000"},"payload":{},"requestId":null,"traceId":null,"createdAt":1760000000000}\n\n'
      )
    }
  }
]
