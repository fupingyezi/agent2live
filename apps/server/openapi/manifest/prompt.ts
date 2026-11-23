import {
  acceptSuggestionInputSchema,
  applyPromptReverseInputSchema,
  commitPromptDraftInputSchema,
  createDraftInputSchema,
  emptyBodySchema,
  listPromptReverseResultsQuerySchema,
  promptInputMultipartMetadataSchema,
  promptReverseInputSchema,
  promptSuggestionInputSchema,
  promptSyncInputSchema,
  savePromptDraftInputSchema
} from '@agent2live/contracts'
import { id, json, params, type OperationSpec } from './types'

export const promptOperations: OperationSpec[] = [
  {
    group: 'prompt',
    method: 'POST',
    path: '/api/v1/art-projects/:id/prompt-inputs',
    operationId: 'prompt.inputs.create',
    tag: '提示词',
    summary: '提交提示词输入与素材',
    params: params({ id: id('artp') }),
    request: {
      kind: 'multipart',
      metadata: promptInputMultipartMetadataSchema,
      files: 'dynamic'
    },
    headers: ['if-match'],
    responses: { 201: json('PromptInputResult') }
  },
  {
    group: 'prompt',
    method: 'POST',
    path: '/api/v1/art-projects/:id/prompt-drafts',
    operationId: 'prompt.drafts.create',
    tag: '提示词',
    summary: '创建提示词草稿',
    params: params({ id: id('artp') }),
    request: { kind: 'json', schema: createDraftInputSchema },
    headers: ['idempotency-key'],
    responses: { 201: json('PromptDraftDto') }
  },
  {
    group: 'prompt',
    method: 'PATCH',
    path: '/api/v1/art-projects/:id/prompt-drafts/:draftId',
    operationId: 'prompt.drafts.update',
    tag: '提示词',
    summary: '保存提示词草稿',
    params: params({ id: id('artp'), draftId: id('pd') }),
    request: { kind: 'json', schema: savePromptDraftInputSchema },
    headers: ['if-match'],
    responseHeaders: ['etag'],
    responses: { 200: json('PromptDraftDto') }
  },
  {
    group: 'prompt',
    method: 'POST',
    path: '/api/v1/art-projects/:id/prompt-drafts/:draftId/commit',
    operationId: 'prompt.drafts.commit',
    tag: '提示词',
    summary: '提交提示词草稿为新版本',
    params: params({ id: id('artp'), draftId: id('pd') }),
    request: { kind: 'json', schema: commitPromptDraftInputSchema },
    headers: ['if-match', 'idempotency-key'],
    responseHeaders: ['etag'],
    responses: { 201: json('PromptCommitResult') }
  },
  {
    group: 'prompt',
    method: 'GET',
    path: '/api/v1/art-projects/:id/prompt',
    operationId: 'prompt.workspace.get',
    tag: '提示词',
    summary: '获取提示词工作区',
    params: params({ id: id('artp') }),
    responses: { 200: json('PromptWorkspaceDto') }
  },
  {
    group: 'prompt',
    method: 'GET',
    path: '/api/v1/art-projects/:id/prompt-versions',
    operationId: 'prompt.versions.list',
    tag: '提示词',
    summary: '列出提示词版本',
    params: params({ id: id('artp') }),
    responses: { 200: json('PromptVersionListResponse') }
  },
  {
    group: 'prompt',
    method: 'GET',
    path: '/api/v1/art-projects/:id/prompt-versions/:versionId',
    operationId: 'prompt.versions.get',
    tag: '提示词',
    summary: '获取提示词版本',
    params: params({ id: id('artp'), versionId: id('pv') }),
    responses: { 200: json('PromptVersionDto') }
  },
  {
    group: 'prompt',
    method: 'POST',
    path: '/api/v1/art-projects/:id/prompt-drafts/:draftId/sync',
    operationId: 'prompt.sync.start',
    tag: '提示词',
    summary: '启动提示词同步任务',
    params: params({ id: id('artp'), draftId: id('pd') }),
    request: { kind: 'json', schema: promptSyncInputSchema },
    headers: ['idempotency-key', 'if-match'],
    responseHeaders: ['location'],
    responses: { 202: json('PromptSyncStartResult') }
  },
  {
    group: 'prompt',
    method: 'POST',
    path: '/api/v1/art-projects/:id/prompt-reverse',
    operationId: 'prompt.reverse.start',
    tag: '提示词',
    summary: '启动提示词反推任务',
    params: params({ id: id('artp') }),
    request: { kind: 'json', schema: promptReverseInputSchema },
    headers: ['idempotency-key'],
    responseHeaders: ['location'],
    responses: { 202: json('PromptReverseStartResult') }
  },
  {
    group: 'prompt',
    method: 'GET',
    path: '/api/v1/art-projects/:id/prompt-reverse-results',
    operationId: 'prompt.reverseResults.list',
    tag: '提示词',
    summary: '列出提示词反推结果',
    params: params({ id: id('artp') }),
    query: listPromptReverseResultsQuerySchema,
    responses: { 200: json('PromptReverseResultListResponse') }
  },
  {
    group: 'prompt',
    method: 'GET',
    path: '/api/v1/prompt-reverse-results/:resultId',
    operationId: 'prompt.reverseResults.get',
    tag: '提示词',
    summary: '获取提示词反推结果',
    params: params({ resultId: id('prv') }),
    responses: { 200: json('PromptReverseResultDto') }
  },
  {
    group: 'prompt',
    method: 'POST',
    path: '/api/v1/prompt-reverse-results/:resultId/apply',
    operationId: 'prompt.reverseResults.apply',
    tag: '提示词',
    summary: '应用提示词反推结果',
    params: params({ resultId: id('prv') }),
    request: { kind: 'json', schema: applyPromptReverseInputSchema },
    headers: ['if-match'],
    responseHeaders: ['etag'],
    responses: { 200: json('PromptReverseApplyResult') }
  },
  {
    group: 'prompt',
    method: 'POST',
    path: '/api/v1/prompt-reverse-results/:resultId/discard',
    operationId: 'prompt.reverseResults.discard',
    tag: '提示词',
    summary: '丢弃提示词反推结果',
    params: params({ resultId: id('prv') }),
    responses: { 200: json('PromptReverseResultDto') }
  },
  {
    group: 'prompt',
    method: 'POST',
    path: '/api/v1/prompt-versions/:versionId/suggestions',
    operationId: 'prompt.suggestions.startFromVersion',
    tag: '提示词',
    summary: '从提示词版本启动改写建议',
    params: params({ versionId: id('pv') }),
    request: { kind: 'json', schema: promptSuggestionInputSchema },
    headers: ['idempotency-key'],
    responseHeaders: ['location'],
    responses: { 202: json('PromptSuggestionStartResult') }
  },
  {
    group: 'prompt',
    method: 'POST',
    path: '/api/v1/art-projects/:id/prompt-drafts/:draftId/suggestions',
    operationId: 'prompt.suggestions.startFromDraft',
    tag: '提示词',
    summary: '从提示词草稿启动改写建议',
    params: params({ id: id('artp'), draftId: id('pd') }),
    request: { kind: 'json', schema: promptSuggestionInputSchema },
    headers: ['idempotency-key'],
    responseHeaders: ['location'],
    responses: { 202: json('PromptSuggestionStartResult') }
  },
  {
    group: 'prompt',
    method: 'GET',
    path: '/api/v1/prompt-suggestions/:suggestionId',
    operationId: 'prompt.suggestions.get',
    tag: '提示词',
    summary: '获取提示词改写建议',
    params: params({ suggestionId: id('psg') }),
    responses: { 200: json('PromptSuggestionDto') }
  },
  {
    group: 'prompt',
    method: 'POST',
    path: '/api/v1/prompt-suggestions/:suggestionId/accept',
    operationId: 'prompt.suggestions.accept',
    tag: '提示词',
    summary: '接受提示词改写建议',
    params: params({ suggestionId: id('psg') }),
    request: { kind: 'json', schema: acceptSuggestionInputSchema },
    responses: { 200: json('PromptSuggestionAcceptResult') }
  },
  {
    group: 'prompt',
    method: 'POST',
    path: '/api/v1/prompt-suggestions/:suggestionId/reject',
    operationId: 'prompt.suggestions.reject',
    tag: '提示词',
    summary: '拒绝提示词改写建议',
    params: params({ suggestionId: id('psg') }),
    request: { kind: 'json', schema: emptyBodySchema },
    responses: { 200: json('PromptSuggestionDto') }
  }
]
