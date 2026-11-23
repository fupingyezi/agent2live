import { z } from 'zod'
import type { ResponseTypeName } from '../response-types'

export type ManifestGroup = 'system' | 'characters' | 'projects' | 'prompt' | 'generations' | 'resources'

export type Tag =
  | '系统'
  | '事件'
  | '角色'
  | '艺术项目'
  | '提示词'
  | '生成'
  | '任务'
  | '供应商'
  | '资产'
  | '备份'

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'
export type RequestHeader = 'if-match' | 'idempotency-key'
export type ResponseHeader = 'etag' | 'location' | 'retry-after' | 'content-disposition'

export type RequestBodySpec =
  | { kind: 'json'; schema: z.ZodTypeAny }
  | { kind: 'multipart'; metadata: z.ZodTypeAny; files: 'single' | 'dynamic' }

export type ResponseBodySpec =
  | { kind: 'json'; type: ResponseTypeName }
  | { kind: 'empty' }
  | { kind: 'binary'; mediaTypes: string[] }
  | { kind: 'sse'; description: string; example: string }

export interface OperationSpec {
  group: ManifestGroup
  method: HttpMethod
  path: string
  operationId: string
  tag: Tag
  summary: string
  description?: string
  params?: z.ZodTypeAny
  query?: z.ZodTypeAny
  request?: RequestBodySpec
  headers?: RequestHeader[]
  responseHeaders?: ResponseHeader[]
  responses: Partial<Record<number | 'default', ResponseBodySpec>>
}

export const json = (type: ResponseTypeName): ResponseBodySpec => ({ kind: 'json', type })
export const empty: ResponseBodySpec = { kind: 'empty' }
export const binary = (mediaTypes: string[]): ResponseBodySpec => ({
  kind: 'binary',
  mediaTypes
})
export const sse = (description: string, example: string): ResponseBodySpec => ({
  kind: 'sse',
  description,
  example
})

export const params = (fields: Record<string, z.ZodTypeAny>): z.ZodTypeAny => z.object(fields)
export const id = (prefix: string): z.ZodType<string> =>
  z.string().regex(new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`))
