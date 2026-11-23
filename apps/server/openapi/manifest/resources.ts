import { z } from 'zod'
import {
  createProviderConnectionInputSchema,
  providerModelsPreviewInputSchema,
  providerProbeInputSchema,
  updateProviderConnectionInputSchema
} from '@agent2live/contracts'
import { binary, id, json, params, type OperationSpec } from './types'

export const resourceOperations: OperationSpec[] = [
  {
    group: 'resources',
    method: 'GET',
    path: '/api/v1/providers',
    operationId: 'providers.list',
    tag: '供应商',
    summary: '列出模型供应商连接',
    responses: { 200: json('ProviderListResponse') }
  },
  {
    group: 'resources',
    method: 'GET',
    path: '/api/v1/providers/:id',
    operationId: 'providers.get',
    tag: '供应商',
    summary: '获取模型供应商连接',
    params: params({ id: id('conn') }),
    responses: { 200: json('ProviderConnectionDto') }
  },
  {
    group: 'resources',
    method: 'POST',
    path: '/api/v1/providers',
    operationId: 'providers.create',
    tag: '供应商',
    summary: '创建模型供应商连接',
    request: { kind: 'json', schema: createProviderConnectionInputSchema },
    headers: ['idempotency-key'],
    responseHeaders: ['etag', 'location'],
    responses: { 201: json('ProviderConnectionDto') }
  },
  {
    group: 'resources',
    method: 'PATCH',
    path: '/api/v1/providers/:id',
    operationId: 'providers.update',
    tag: '供应商',
    summary: '更新模型供应商连接',
    params: params({ id: id('conn') }),
    request: { kind: 'json', schema: updateProviderConnectionInputSchema },
    headers: ['if-match'],
    responseHeaders: ['etag'],
    responses: { 200: json('ProviderConnectionDto') }
  },
  {
    group: 'resources',
    method: 'POST',
    path: '/api/v1/providers/:id/test',
    operationId: 'providers.test',
    tag: '供应商',
    summary: '测试模型供应商连接',
    params: params({ id: id('conn') }),
    request: { kind: 'json', schema: providerProbeInputSchema },
    responses: { 200: json('ProviderProbeDto') }
  },
  {
    group: 'resources',
    method: 'POST',
    path: '/api/v1/provider-models',
    operationId: 'providerModels.preview',
    tag: '供应商',
    summary: '预览供应商模型目录',
    request: { kind: 'json', schema: providerModelsPreviewInputSchema },
    responses: { 200: json('ProviderModelListDto') }
  },
  {
    group: 'resources',
    method: 'POST',
    path: '/api/v1/providers/:id/models/refresh',
    operationId: 'providers.refreshModels',
    tag: '供应商',
    summary: '刷新供应商模型目录',
    params: params({ id: id('conn') }),
    headers: ['if-match'],
    responseHeaders: ['etag'],
    responses: { 200: json('ProviderConnectionDto') }
  },
  {
    group: 'resources',
    method: 'POST',
    path: '/api/v1/assets',
    operationId: 'assets.upload',
    tag: '资产',
    summary: '上传资产并按 sha256 去重',
    request: { kind: 'multipart', metadata: z.object({}), files: 'single' },
    responseHeaders: ['etag'],
    responses: { 200: json('AssetDto'), 201: json('AssetDto') }
  },
  {
    group: 'resources',
    method: 'GET',
    path: '/api/v1/assets/:id',
    operationId: 'assets.get',
    tag: '资产',
    summary: '获取资产',
    params: params({ id: id('ast') }),
    responses: { 200: json('AssetDto') }
  },
  {
    group: 'resources',
    method: 'GET',
    path: '/api/v1/assets/:id/content',
    operationId: 'assets.content',
    tag: '资产',
    summary: '获取资产内容',
    params: params({ id: id('ast') }),
    responseHeaders: ['etag'],
    responses: { 200: binary(['image/png', 'image/jpeg', 'image/webp']) }
  },
  {
    group: 'resources',
    method: 'POST',
    path: '/api/v1/characters/:id/backups',
    operationId: 'backups.create',
    tag: '备份',
    summary: '创建角色备份',
    params: params({ id: id('chr') }),
    headers: ['idempotency-key'],
    responseHeaders: ['location', 'retry-after'],
    responses: { 202: json('CharacterBackupDto') }
  },
  {
    group: 'resources',
    method: 'GET',
    path: '/api/v1/characters/:id/backups',
    operationId: 'backups.list',
    tag: '备份',
    summary: '列出角色备份',
    params: params({ id: id('chr') }),
    responses: { 200: json('CharacterBackupListResponse') }
  },
  {
    group: 'resources',
    method: 'GET',
    path: '/api/v1/backups/:backupId',
    operationId: 'backups.get',
    tag: '备份',
    summary: '获取角色备份',
    params: params({ backupId: id('bkp') }),
    responses: { 200: json('CharacterBackupDto') }
  },
  {
    group: 'resources',
    method: 'GET',
    path: '/api/v1/backups/:backupId/download',
    operationId: 'backups.download',
    tag: '备份',
    summary: '下载角色备份',
    params: params({ backupId: id('bkp') }),
    responseHeaders: ['content-disposition'],
    responses: { 200: binary(['application/zip']) }
  }
]
