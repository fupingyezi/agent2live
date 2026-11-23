import { z } from 'zod'
import { manifest } from './manifest'
import type { OperationSpec, ResponseBodySpec } from './manifest/types'
import { buildResponseSchemas, zodSchemaToJsonSchema } from './schema-registry'

export const OPENAPI_TITLE = 'agent2live Local API'

const COMMON_ERROR_STATUSES = [400, 401, 404, 409, 422, 429, 500, 503] as const

const TAGS = [
  ['系统', '服务健康状态'],
  ['事件', 'SSE 事件流'],
  ['角色', '角色与角色设定'],
  ['艺术项目', 'ArtProject、立绘和 Fork'],
  ['提示词', '提示词草稿、版本、同步、反推和建议'],
  ['生成', '生图任务与候选'],
  ['供应商', '模型供应商连接'],
  ['资产', '上传与资产内容'],
  ['任务', '后台任务'],
  ['备份', '角色备份']
].map(([name, description]) => ({ name, description }))

const HEADER_PARAMS = {
  'if-match': { $ref: '#/components/parameters/IfMatch' },
  'idempotency-key': { $ref: '#/components/parameters/IdempotencyKey' }
} as const

function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
}

function parametersFor(schema: z.ZodTypeAny, location: 'path' | 'query'): Array<Record<string, unknown>> {
  if (!(schema instanceof z.ZodObject)) {
    throw new Error(`expected object schema for ${location}`)
  }
  const shape = schema.shape as Record<string, z.ZodTypeAny>
  return Object.entries(shape).map(([name, field]) => ({
    name,
    in: location,
    required: location === 'path' ? true : !field.isOptional(),
    schema: zodSchemaToJsonSchema(field)
  }))
}

function responseHeaders(keys: OperationSpec['responseHeaders']): Record<string, unknown> {
  const map = {
    etag: { description: 'Entity tag', schema: { type: 'string' } },
    location: { description: 'Created resource location', schema: { type: 'string' } },
    'retry-after': { description: 'Retry delay in seconds', schema: { type: 'string' } },
    'content-disposition': {
      description: 'Attachment disposition',
      schema: { type: 'string' }
    }
  }
  return Object.fromEntries((keys ?? []).map((key) => [key, map[key]]))
}

function buildRequestBody(request: OperationSpec['request']): Record<string, unknown> | undefined {
  if (!request) return undefined
  if (request.kind === 'json') {
    return {
      required: true,
      content: {
        'application/json': { schema: zodSchemaToJsonSchema(request.schema) }
      }
    }
  }
  if (request.files === 'single') {
    return {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            required: ['file'],
            properties: {
              file: { type: 'string', format: 'binary' }
            }
          }
        }
      }
    }
  }
  return {
    required: true,
    content: {
      'multipart/form-data': {
        schema: {
          type: 'object',
          required: ['metadata'],
          properties: {
            metadata: {
              type: 'string',
              description: 'JSON encoded metadata; file fields are named by metadata.materials[].fileField'
            }
          },
          additionalProperties: { type: 'string', format: 'binary' },
          'x-metadata-schema': zodSchemaToJsonSchema(request.metadata)
        }
      }
    }
  }
}

function buildResponse(spec: ResponseBodySpec, headers: Record<string, unknown>): Record<string, unknown> {
  if (spec.kind === 'empty') return { description: 'No content', headers }
  if (spec.kind === 'binary') {
    return {
      description: 'Binary response',
      headers,
      content: Object.fromEntries(
        spec.mediaTypes.map((mediaType) => [mediaType, { schema: { type: 'string', format: 'binary' } }])
      )
    }
  }
  if (spec.kind === 'sse') {
    return {
      description: spec.description,
      headers,
      content: {
        'text/event-stream': {
          schema: { type: 'string' },
          example: spec.example,
          'x-event-schema': { $ref: '#/components/schemas/SseEvent' }
        }
      }
    }
  }
  return {
    description: `${spec.type} response`,
    headers,
    content: {
      'application/json': {
        schema: { $ref: `#/components/schemas/${spec.type}` }
      }
    }
  }
}

function problemResponse(): Record<string, unknown> {
  return {
    description: 'Problem details',
    content: {
      'application/problem+json': {
        schema: { $ref: '#/components/schemas/ProblemDetails' }
      }
    }
  }
}

function buildOperation(operation: OperationSpec): Record<string, unknown> {
  const parameters = [
    ...(operation.params ? parametersFor(operation.params, 'path') : []),
    ...(operation.query ? parametersFor(operation.query, 'query') : []),
    ...(operation.headers ?? []).map((header) => HEADER_PARAMS[header])
  ]
  const responses: Record<string, unknown> = {}
  for (const [status, spec] of Object.entries(operation.responses)) {
    if (spec) responses[status] = buildResponse(spec, responseHeaders(operation.responseHeaders))
  }
  for (const status of COMMON_ERROR_STATUSES) {
    responses[String(status)] = problemResponse()
  }
  responses.default = problemResponse()
  return {
    operationId: operation.operationId,
    tags: [operation.tag],
    summary: operation.summary,
    ...(operation.description ? { description: operation.description } : {}),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(operation.request ? { requestBody: buildRequestBody(operation.request) } : {}),
    responses
  }
}

export function buildOpenApiDocument(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const operation of manifest) {
    const path = toOpenApiPath(operation.path)
    const pathItem = paths[path] ?? {}
    pathItem[operation.method.toLowerCase()] = buildOperation(operation)
    paths[path] = pathItem
  }
  return {
    openapi: '3.0.3',
    info: {
      title: OPENAPI_TITLE,
      version: '1.0.0',
      description: 'agent2live 本地 sidecar API。token 来自 runtime/endpoint.json；端口为动态值。'
    },
    servers: [
      {
        url: 'http://127.0.0.1:{port}',
        variables: {
          port: {
            default: '43123',
            description: 'runtime/endpoint.json 中的实际端口'
          }
        }
      }
    ],
    security: [{ bearerAuth: [] }],
    tags: TAGS,
    paths,
    components: {
      schemas: buildResponseSchemas(),
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: '本地 sidecar bearer token'
        }
      },
      parameters: {
        IfMatch: {
          name: 'If-Match',
          in: 'header',
          required: false,
          schema: { type: 'string' },
          description: 'quoted rowVersion；需要条件更新时提供'
        },
        IdempotencyKey: {
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
          schema: { type: 'string' },
          description: '8-128 位幂等键'
        }
      }
    }
  }
}
