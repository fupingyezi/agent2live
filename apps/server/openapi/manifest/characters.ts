import {
  characterLineageQuerySchema,
  createArtProjectInputSchema,
  createCharacterBriefVersionInputSchema,
  createCharacterInputSchema,
  createForkInputSchema,
  patchForkInputSchema,
  updateArtProjectInputSchema,
  updateCharacterInputSchema
} from '@agent2live/contracts'
import { empty, id, json, params, type OperationSpec } from './types'

export const characterProjectOperations: OperationSpec[] = [
  {
    group: 'characters',
    method: 'GET',
    path: '/api/v1/characters',
    operationId: 'characters.list',
    tag: '角色',
    summary: '列出角色',
    responses: { 200: json('CharacterListResponse') }
  },
  {
    group: 'characters',
    method: 'GET',
    path: '/api/v1/characters/:id',
    operationId: 'characters.get',
    tag: '角色',
    summary: '获取单个角色',
    params: params({ id: id('chr') }),
    responses: { 200: json('CharacterDto') }
  },
  {
    group: 'characters',
    method: 'POST',
    path: '/api/v1/characters',
    operationId: 'characters.create',
    tag: '角色',
    summary: '创建角色',
    request: { kind: 'json', schema: createCharacterInputSchema },
    responseHeaders: ['etag', 'location'],
    responses: { 201: json('CharacterDto') }
  },
  {
    group: 'characters',
    method: 'PATCH',
    path: '/api/v1/characters/:id',
    operationId: 'characters.update',
    tag: '角色',
    summary: '更新角色',
    params: params({ id: id('chr') }),
    request: { kind: 'json', schema: updateCharacterInputSchema },
    headers: ['if-match'],
    responseHeaders: ['etag'],
    responses: { 200: json('CharacterDto') }
  },
  {
    group: 'characters',
    method: 'DELETE',
    path: '/api/v1/characters/:id',
    operationId: 'characters.delete',
    tag: '角色',
    summary: '删除角色',
    params: params({ id: id('chr') }),
    headers: ['if-match'],
    responses: { 204: empty }
  },
  {
    group: 'characters',
    method: 'GET',
    path: '/api/v1/characters/:id/brief-versions',
    operationId: 'characters.briefVersions.list',
    tag: '角色',
    summary: '列出角色设定版本',
    params: params({ id: id('chr') }),
    responses: { 200: json('CharacterBriefVersionListResponse') }
  },
  {
    group: 'characters',
    method: 'POST',
    path: '/api/v1/characters/:id/brief-versions',
    operationId: 'characters.briefVersions.create',
    tag: '角色',
    summary: '创建角色设定版本',
    params: params({ id: id('chr') }),
    request: { kind: 'json', schema: createCharacterBriefVersionInputSchema },
    responseHeaders: ['etag', 'location'],
    responses: { 201: json('CharacterBriefVersion') }
  },
  {
    group: 'projects',
    method: 'POST',
    path: '/api/v1/characters/:id/art-projects',
    operationId: 'artProjects.createForCharacter',
    tag: '艺术项目',
    summary: '为角色创建艺术项目',
    params: params({ id: id('chr') }),
    request: { kind: 'json', schema: createArtProjectInputSchema },
    responseHeaders: ['etag', 'location'],
    responses: { 201: json('ArtProjectDto') }
  },
  {
    group: 'projects',
    method: 'GET',
    path: '/api/v1/art-projects/:id',
    operationId: 'artProjects.get',
    tag: '艺术项目',
    summary: '获取艺术项目',
    params: params({ id: id('artp') }),
    responses: { 200: json('ArtProjectDto') }
  },
  {
    group: 'projects',
    method: 'PATCH',
    path: '/api/v1/art-projects/:id',
    operationId: 'artProjects.update',
    tag: '艺术项目',
    summary: '更新艺术项目',
    params: params({ id: id('artp') }),
    request: { kind: 'json', schema: updateArtProjectInputSchema },
    headers: ['if-match'],
    responseHeaders: ['etag'],
    responses: { 200: json('ArtProjectDto') }
  },
  {
    group: 'projects',
    method: 'DELETE',
    path: '/api/v1/art-projects/:id',
    operationId: 'artProjects.delete',
    tag: '艺术项目',
    summary: '删除艺术项目',
    params: params({ id: id('artp') }),
    headers: ['if-match'],
    responses: { 204: empty }
  },
  {
    group: 'projects',
    method: 'GET',
    path: '/api/v1/art-projects/:id/tree',
    operationId: 'artProjects.tree',
    tag: '艺术项目',
    summary: '获取艺术项目子树',
    params: params({ id: id('artp') }),
    responses: { 200: json('ProjectTreeDto') }
  },
  {
    group: 'projects',
    method: 'GET',
    path: '/api/v1/art-projects/tree',
    operationId: 'artProjects.lineage',
    tag: '艺术项目',
    summary: '获取角色艺术项目谱系',
    query: characterLineageQuerySchema,
    responses: { 200: json('CharacterLineageDto') }
  },
  {
    group: 'projects',
    method: 'POST',
    path: '/api/v1/prompt-versions/:versionId/forks',
    operationId: 'forks.createFromPromptVersion',
    tag: '艺术项目',
    summary: '从 PromptVersion 创建 Fork',
    params: params({ versionId: id('pv') }),
    request: { kind: 'json', schema: createForkInputSchema },
    headers: ['idempotency-key'],
    responseHeaders: ['etag', 'location'],
    responses: { 201: json('ForkResultDto') }
  },
  {
    group: 'projects',
    method: 'POST',
    path: '/api/v1/art-versions/:versionId/forks',
    operationId: 'forks.createFromArtVersion',
    tag: '艺术项目',
    summary: '从 ArtVersion 创建 Fork',
    params: params({ versionId: id('av') }),
    request: { kind: 'json', schema: createForkInputSchema },
    headers: ['idempotency-key'],
    responseHeaders: ['etag', 'location'],
    responses: { 201: json('ForkResultDto') }
  },
  {
    group: 'projects',
    method: 'PATCH',
    path: '/api/v1/art-projects/:id/fork-link',
    operationId: 'forks.updateLink',
    tag: '艺术项目',
    summary: '更新 Fork 链接',
    params: params({ id: id('artp') }),
    request: { kind: 'json', schema: patchForkInputSchema },
    headers: ['idempotency-key'],
    responseHeaders: ['etag'],
    responses: { 200: json('ForkLinkMutationDto') }
  }
]
