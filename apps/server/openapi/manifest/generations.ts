import { z } from 'zod'
import {
  acceptGenerationCandidateInputSchema,
  activateArtVersionInputSchema,
  artVersionListQuerySchema,
  createGenerationInputSchema,
  createManualArtVersionInputSchema,
  generationListQuerySchema
} from '@agent2live/contracts'
import { id, json, params, type OperationSpec } from './types'

const jobEventsQuerySchema = z.object({
  after: z.coerce.number().int().min(0).optional()
})

export const generationOperations: OperationSpec[] = [
  {
    group: 'generations',
    method: 'POST',
    path: '/api/v1/art-projects/:id/generations',
    operationId: 'generations.create',
    tag: '生成',
    summary: '创建生图任务',
    params: params({ id: id('artp') }),
    request: { kind: 'json', schema: createGenerationInputSchema },
    headers: ['idempotency-key'],
    responseHeaders: ['location'],
    responses: { 202: json('GenerationCreateResult') }
  },
  {
    group: 'generations',
    method: 'GET',
    path: '/api/v1/generations/:generationId',
    operationId: 'generations.get',
    tag: '生成',
    summary: '获取生成任务',
    params: params({ generationId: id('gen') }),
    responses: { 200: json('GenerationDto') }
  },
  {
    group: 'generations',
    method: 'GET',
    path: '/api/v1/art-projects/:id/generations',
    operationId: 'generations.list',
    tag: '生成',
    summary: '列出项目的生成任务',
    params: params({ id: id('artp') }),
    query: generationListQuerySchema,
    responses: { 200: json('GenerationListResponse') }
  },
  {
    group: 'generations',
    method: 'POST',
    path: '/api/v1/generations/:generationId/discard',
    operationId: 'generations.discard',
    tag: '生成',
    summary: '丢弃生成任务',
    params: params({ generationId: id('gen') }),
    headers: ['idempotency-key'],
    responses: { 200: json('GenerationDto') }
  },
  {
    group: 'generations',
    method: 'GET',
    path: '/api/v1/art-projects/:id/art-versions',
    operationId: 'artVersions.list',
    tag: '艺术项目',
    summary: '列出立绘版本',
    params: params({ id: id('artp') }),
    query: artVersionListQuerySchema,
    responses: { 200: json('ArtVersionListDto') }
  },
  {
    group: 'generations',
    method: 'GET',
    path: '/api/v1/art-projects/:id/art-versions/:versionId',
    operationId: 'artVersions.get',
    tag: '艺术项目',
    summary: '获取立绘版本',
    params: params({ id: id('artp'), versionId: id('av') }),
    responses: { 200: json('ArtVersionDto') }
  },
  {
    group: 'generations',
    method: 'POST',
    path: '/api/v1/art-projects/:id/art-versions/manual',
    operationId: 'artVersions.createManual',
    tag: '艺术项目',
    summary: '创建手工立绘版本',
    params: params({ id: id('artp') }),
    request: { kind: 'json', schema: createManualArtVersionInputSchema },
    headers: ['idempotency-key', 'if-match'],
    responseHeaders: ['etag', 'location'],
    responses: { 201: json('ArtVersionMutationDto') }
  },
  {
    group: 'generations',
    method: 'POST',
    path: '/api/v1/generation-candidates/:candidateId/accept',
    operationId: 'generationCandidates.accept',
    tag: '生成',
    summary: '接受生成候选',
    params: params({ candidateId: id('cand') }),
    request: { kind: 'json', schema: acceptGenerationCandidateInputSchema },
    headers: ['idempotency-key'],
    responseHeaders: ['etag', 'location'],
    responses: { 201: json('ArtVersionMutationDto') }
  },
  {
    group: 'generations',
    method: 'POST',
    path: '/api/v1/art-projects/:id/art-versions/:versionId/activate',
    operationId: 'artVersions.activate',
    tag: '艺术项目',
    summary: '激活立绘版本',
    params: params({ id: id('artp'), versionId: id('av') }),
    request: { kind: 'json', schema: activateArtVersionInputSchema },
    headers: ['idempotency-key', 'if-match'],
    responseHeaders: ['etag'],
    responses: { 200: json('ArtVersionMutationDto') }
  },
  {
    group: 'generations',
    method: 'GET',
    path: '/api/v1/jobs/:id',
    operationId: 'jobs.get',
    tag: '任务',
    summary: '获取后台任务',
    params: params({ id: id('job') }),
    responses: { 200: json('JobDto') }
  },
  {
    group: 'generations',
    method: 'GET',
    path: '/api/v1/jobs/:id/events',
    operationId: 'jobs.events',
    tag: '任务',
    summary: '列出后台任务事件',
    params: params({ id: id('job') }),
    query: jobEventsQuerySchema,
    responses: { 200: json('JobEventListResponse') }
  },
  {
    group: 'generations',
    method: 'POST',
    path: '/api/v1/jobs/:id/cancel',
    operationId: 'jobs.cancel',
    tag: '任务',
    summary: '取消后台任务',
    params: params({ id: id('job') }),
    responses: { 200: json('JobDto') }
  }
]
