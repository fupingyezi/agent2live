import { ApiClient, newIdempotencyKey } from './client'
import type {
  CreateProviderConnectionInput,
  ProviderProbeInput,
  UpdateProviderConnectionInput
} from '@agent2live/contracts/api'
import type {
  ArtProjectDto,
  ArtVersionDto,
  ArtVersionListDto,
  ArtVersionMutationDto,
  ArtVersionReferenceDto,
  AssetDto,
  CharacterBackupDto,
  CharacterDto,
  CharacterLineageDto,
  CreateArtProjectInput,
  CreateCharacterInput,
  CreateForkInput,
  CreateGenerationResultDto,
  ForkLinkMutationDto,
  ForkResultDto,
  GenerationDto,
  ItemsResponse,
  JobDto,
  JobEventDto,
  MaterialRole,
  PromptDraftDto,
  PromptRequirement,
  PromptReverseResultDto,
  PromptSuggestionDto,
  PromptSpecV2,
  PromptVersionDto,
  PromptVersionSummaryDto,
  PromptWorkspaceDto,
  ProviderConnectionDto,
  ProviderProbeDto,
  SubmitPromptInputResult
} from './types'

function getServerInfo(): ReturnType<NonNullable<Window['agent2live']>['getServerInfo']> {
  const bridge = window.agent2live
  if (!bridge) return Promise.reject(new Error('agent2live preload bridge is unavailable'))
  return bridge.getServerInfo()
}

export const api = new ApiClient({ getServerInfo })

function withSignal(signal?: AbortSignal): { signal?: AbortSignal } {
  return signal === undefined ? {} : { signal }
}

export async function listCharacters(signal?: AbortSignal): Promise<CharacterDto[]> {
  const response = await api.request<ItemsResponse<CharacterDto>>('/api/v1/characters', withSignal(signal))
  return response.items
}

export function getCharacter(characterId: string, signal?: AbortSignal): Promise<CharacterDto> {
  return api.request<CharacterDto>(
    `/api/v1/characters/${encodeURIComponent(characterId)}`,
    withSignal(signal)
  )
}

export function createCharacter(
  input: CreateCharacterInput,
  idempotencyKey = newIdempotencyKey()
): Promise<CharacterDto> {
  return api.request<CharacterDto>('/api/v1/characters', {
    method: 'POST',
    body: input,
    idempotencyKey
  })
}

export async function getCharacterLineage(
  characterId: string,
  signal?: AbortSignal
): Promise<CharacterLineageDto> {
  return api.request<CharacterLineageDto>(
    `/api/v1/art-projects/tree?characterId=${encodeURIComponent(characterId)}`,
    withSignal(signal)
  )
}

export function createArtProject(
  characterId: string,
  input: CreateArtProjectInput,
  idempotencyKey = newIdempotencyKey()
): Promise<ArtProjectDto> {
  return api.request<ArtProjectDto>(`/api/v1/characters/${encodeURIComponent(characterId)}/art-projects`, {
    method: 'POST',
    body: input,
    idempotencyKey
  })
}

export function getArtProject(projectId: string, signal?: AbortSignal): Promise<ArtProjectDto> {
  return api.request<ArtProjectDto>(
    `/api/v1/art-projects/${encodeURIComponent(projectId)}`,
    withSignal(signal)
  )
}

export function getJob(jobId: string, signal?: AbortSignal): Promise<JobDto> {
  return api.request<JobDto>(`/api/v1/jobs/${encodeURIComponent(jobId)}`, withSignal(signal))
}

export async function listJobEvents(jobId: string, after = 0, signal?: AbortSignal): Promise<JobEventDto[]> {
  const response = await api.request<ItemsResponse<JobEventDto>>(
    `/api/v1/jobs/${encodeURIComponent(jobId)}/events?after=${encodeURIComponent(String(after))}`,
    withSignal(signal)
  )
  return response.items
}

export function getAssetContent(assetId: string, signal?: AbortSignal): Promise<Blob> {
  return api.requestBlob(`/api/v1/assets/${encodeURIComponent(assetId)}/content`, withSignal(signal))
}

export async function listProviders(signal?: AbortSignal): Promise<ProviderConnectionDto[]> {
  const response = await api.request<ItemsResponse<ProviderConnectionDto>>(
    '/api/v1/providers',
    withSignal(signal)
  )
  return response.items
}

export function getPromptWorkspace(projectId: string, signal?: AbortSignal): Promise<PromptWorkspaceDto> {
  return api.request<PromptWorkspaceDto>(
    `/api/v1/art-projects/${encodeURIComponent(projectId)}/prompt`,
    withSignal(signal)
  )
}

export function createPromptDraft(
  projectId: string,
  from: 'active_version' | 'empty',
  idempotencyKey = newIdempotencyKey()
): Promise<PromptDraftDto> {
  return api.request<PromptDraftDto>(`/api/v1/art-projects/${encodeURIComponent(projectId)}/prompt-drafts`, {
    method: 'POST',
    body: { from },
    idempotencyKey
  })
}

export function savePromptDraft(
  projectId: string,
  draftId: string,
  state: PromptSpecV2,
  ifMatch: number
): Promise<PromptDraftDto> {
  return api.request<PromptDraftDto>(
    `/api/v1/art-projects/${encodeURIComponent(projectId)}/prompt-drafts/${encodeURIComponent(draftId)}`,
    { method: 'PATCH', body: { state }, ifMatch }
  )
}

export function commitPromptDraft(
  projectId: string,
  draftId: string,
  ifMatch: number,
  acknowledgeUncoveredRequirements: boolean,
  idempotencyKey = newIdempotencyKey()
): Promise<{ version: PromptVersionDto; project: ArtProjectDto }> {
  return api.request<{ version: PromptVersionDto; project: ArtProjectDto }>(
    `/api/v1/art-projects/${encodeURIComponent(projectId)}/prompt-drafts/${encodeURIComponent(draftId)}/commit`,
    {
      method: 'POST',
      body: { acknowledgeUncoveredRequirements },
      ifMatch,
      idempotencyKey
    }
  )
}

export async function submitPromptInput(
  projectId: string,
  metadata: {
    globalNotes: string
    requirements: PromptRequirement[]
    materials: Array<{
      partName: string
      assetId?: string
      fileField?: string
      role: MaterialRole
      note: string
      weight: number
      locked: boolean
      sortOrder: number
    }>
  },
  files: Map<string, File>,
  ifMatch: number | null
): Promise<SubmitPromptInputResult> {
  const form = new FormData()
  form.set('metadata', JSON.stringify(metadata))
  for (const [field, file] of files) form.set(field, file)
  return api.request<SubmitPromptInputResult>(
    `/api/v1/art-projects/${encodeURIComponent(projectId)}/prompt-inputs`,
    {
      method: 'POST',
      body: form,
      ifMatch
    }
  )
}

export async function listPromptVersions(
  projectId: string,
  signal?: AbortSignal
): Promise<PromptVersionSummaryDto[]> {
  const response = await api.request<ItemsResponse<PromptVersionSummaryDto>>(
    `/api/v1/art-projects/${encodeURIComponent(projectId)}/prompt-versions`,
    withSignal(signal)
  )
  return response.items
}

export function getPromptVersion(
  projectId: string,
  versionId: string,
  signal?: AbortSignal
): Promise<PromptVersionDto> {
  return api.request<PromptVersionDto>(
    `/api/v1/art-projects/${encodeURIComponent(projectId)}/prompt-versions/${encodeURIComponent(versionId)}`,
    withSignal(signal)
  )
}

export function requestPromptReverse(
  projectId: string,
  providerConnectionId: string,
  idempotencyKey = newIdempotencyKey()
): Promise<{ jobId: string; baseDraftRevision: number; baseDraftRowVersion: number }> {
  return api.request(`/api/v1/art-projects/${encodeURIComponent(projectId)}/prompt-reverse`, {
    method: 'POST',
    body: { providerConnectionId },
    idempotencyKey
  })
}

export async function listPromptReverseResults(
  projectId: string,
  signal?: AbortSignal
): Promise<PromptReverseResultDto[]> {
  const response = await api.request<{ items: PromptReverseResultDto[] }>(
    `/api/v1/art-projects/${encodeURIComponent(projectId)}/prompt-reverse-results`,
    withSignal(signal)
  )
  return response.items
}

export function getPromptReverseResult(
  resultId: string,
  signal?: AbortSignal
): Promise<PromptReverseResultDto> {
  return api.request<PromptReverseResultDto>(
    `/api/v1/prompt-reverse-results/${encodeURIComponent(resultId)}`,
    withSignal(signal)
  )
}

export function applyPromptReverseResult(
  resultId: string,
  expectedDraftRowVersion: number
): Promise<{ result: PromptReverseResultDto; draft: PromptDraftDto }> {
  return api.request(`/api/v1/prompt-reverse-results/${encodeURIComponent(resultId)}/apply`, {
    method: 'POST',
    body: {},
    ifMatch: expectedDraftRowVersion
  })
}

export function discardPromptReverseResult(resultId: string): Promise<PromptReverseResultDto> {
  return api.request(`/api/v1/prompt-reverse-results/${encodeURIComponent(resultId)}/discard`, {
    method: 'POST',
    body: {}
  })
}

export function requestPromptSuggestionFromDraft(
  projectId: string,
  draftId: string,
  providerConnectionId: string,
  intent: string,
  idempotencyKey = newIdempotencyKey()
): Promise<{ jobId: string; baseContentHash: string }> {
  return api.request(
    `/api/v1/art-projects/${encodeURIComponent(projectId)}/prompt-drafts/${encodeURIComponent(draftId)}/suggestions`,
    { method: 'POST', body: { providerConnectionId, intent }, idempotencyKey }
  )
}

export function requestPromptSuggestionFromVersion(
  versionId: string,
  providerConnectionId: string,
  intent: string,
  idempotencyKey = newIdempotencyKey()
): Promise<{ jobId: string; baseContentHash: string }> {
  return api.request(`/api/v1/prompt-versions/${encodeURIComponent(versionId)}/suggestions`, {
    method: 'POST',
    body: { providerConnectionId, intent },
    idempotencyKey
  })
}

export function getPromptSuggestion(
  suggestionId: string,
  signal?: AbortSignal
): Promise<PromptSuggestionDto> {
  return api.request<PromptSuggestionDto>(
    `/api/v1/prompt-suggestions/${encodeURIComponent(suggestionId)}`,
    withSignal(signal)
  )
}

export function acceptPromptSuggestion(
  suggestionId: string,
  expectedDraftRowVersion: number | null
): Promise<{ suggestion: PromptSuggestionDto; draft: PromptDraftDto }> {
  return api.request(`/api/v1/prompt-suggestions/${encodeURIComponent(suggestionId)}/accept`, {
    method: 'POST',
    body: { expectedDraftRowVersion }
  })
}

export function rejectPromptSuggestion(suggestionId: string): Promise<PromptSuggestionDto> {
  return api.request(`/api/v1/prompt-suggestions/${encodeURIComponent(suggestionId)}/reject`, {
    method: 'POST',
    body: {}
  })
}

export async function listArtVersions(projectId: string, signal?: AbortSignal): Promise<ArtVersionDto[]> {
  const response = await api.request<ArtVersionListDto>(
    `/api/v1/art-projects/${encodeURIComponent(projectId)}/art-versions`,
    withSignal(signal)
  )
  return response.items
}

export function uploadAsset(file: File): Promise<AssetDto> {
  const form = new FormData()
  form.set('file', file)
  return api.request<AssetDto>('/api/v1/assets', { method: 'POST', body: form })
}

export function createManualArtVersion(
  projectId: string,
  assetId: string,
  expectedProjectRowVersion: number,
  idempotencyKey = newIdempotencyKey()
): Promise<ArtVersionMutationDto> {
  return api.request(`/api/v1/art-projects/${encodeURIComponent(projectId)}/art-versions/manual`, {
    method: 'POST',
    body: { assetId },
    ifMatch: expectedProjectRowVersion,
    idempotencyKey
  })
}

export type ArtVersionReferenceInput = Omit<ArtVersionReferenceDto, 'id'>

export function reviseArtVersionReferences(
  versionId: string,
  references: ArtVersionReferenceInput[],
  reason: 'add' | 'remove' | 'reorder' | 'metadata' | 'switch_primary',
  expectedProjectRowVersion: number,
  idempotencyKey = newIdempotencyKey()
): Promise<ArtVersionMutationDto> {
  return api.request(`/api/v1/art-versions/${encodeURIComponent(versionId)}/reference-revisions`, {
    method: 'POST',
    body: { references, reason },
    ifMatch: expectedProjectRowVersion,
    idempotencyKey
  })
}

export function createGeneration(
  projectId: string,
  input: {
    promptVersionId: string
    providerConnectionId: string
    count: number
    size?: string
    seed?: number | null
  },
  idempotencyKey = newIdempotencyKey()
): Promise<CreateGenerationResultDto> {
  return api.request<CreateGenerationResultDto>(
    `/api/v1/art-projects/${encodeURIComponent(projectId)}/generations`,
    { method: 'POST', body: input, idempotencyKey }
  )
}

export function getGeneration(generationId: string, signal?: AbortSignal): Promise<GenerationDto> {
  return api.request<GenerationDto>(
    `/api/v1/generations/${encodeURIComponent(generationId)}`,
    withSignal(signal)
  )
}

export function acceptGenerationCandidate(
  candidateId: string,
  expectedActiveArtVersionId: string | null,
  idempotencyKey = newIdempotencyKey()
): Promise<ArtVersionMutationDto> {
  return api.request<ArtVersionMutationDto>(
    `/api/v1/generation-candidates/${encodeURIComponent(candidateId)}/accept`,
    { method: 'POST', body: { expectedActiveArtVersionId }, idempotencyKey }
  )
}

export function activateArtVersion(
  projectId: string,
  versionId: string,
  reason: 'switch' | 'rollback',
  ifMatch: number,
  idempotencyKey = newIdempotencyKey()
): Promise<ArtVersionMutationDto> {
  return api.request<ArtVersionMutationDto>(
    `/api/v1/art-projects/${encodeURIComponent(projectId)}/art-versions/${encodeURIComponent(versionId)}/activate`,
    { method: 'POST', body: { reason }, ifMatch, idempotencyKey }
  )
}

export function createForkFromPromptVersion(
  versionId: string,
  input: CreateForkInput,
  idempotencyKey = newIdempotencyKey()
): Promise<ForkResultDto> {
  return api.request<ForkResultDto>(`/api/v1/prompt-versions/${encodeURIComponent(versionId)}/forks`, {
    method: 'POST',
    body: input,
    idempotencyKey
  })
}

export function createForkFromArtVersion(
  versionId: string,
  input: CreateForkInput,
  idempotencyKey = newIdempotencyKey()
): Promise<ForkResultDto> {
  return api.request<ForkResultDto>(`/api/v1/art-versions/${encodeURIComponent(versionId)}/forks`, {
    method: 'POST',
    body: input,
    idempotencyKey
  })
}

export function updateForkLink(
  projectId: string,
  input: { branchLabel?: string; detach?: true },
  idempotencyKey = newIdempotencyKey()
): Promise<ForkLinkMutationDto> {
  return api.request<ForkLinkMutationDto>(`/api/v1/art-projects/${encodeURIComponent(projectId)}/fork-link`, {
    method: 'PATCH',
    body: input,
    idempotencyKey
  })
}

export function detachProject(
  projectId: string,
  idempotencyKey = newIdempotencyKey()
): Promise<ForkLinkMutationDto> {
  return updateForkLink(projectId, { detach: true }, idempotencyKey)
}

export function flattenLineage(roots: CharacterLineageDto['roots']): ArtProjectDto[] {
  const projects: ArtProjectDto[] = []
  const seen = new Set<string>()
  const visit = (node: CharacterLineageDto['roots'][number]): void => {
    if (seen.has(node.project.id)) return
    seen.add(node.project.id)
    projects.push(node.project)
    for (const child of node.children) visit(child)
  }
  for (const root of roots) visit(root)
  return projects
}

export function isTerminalJobStatus(status: JobDto['status']): boolean {
  return ['succeeded', 'failed', 'cancelled', 'unknown_outcome'].includes(status)
}

export function getProvider(providerId: string, signal?: AbortSignal): Promise<ProviderConnectionDto> {
  return api.request<ProviderConnectionDto>(
    `/api/v1/providers/${encodeURIComponent(providerId)}`,
    withSignal(signal)
  )
}

export function createProvider(
  input: CreateProviderConnectionInput,
  idempotencyKey = newIdempotencyKey()
): Promise<ProviderConnectionDto> {
  return api.request<ProviderConnectionDto>('/api/v1/providers', {
    method: 'POST',
    body: input,
    idempotencyKey
  })
}

export function updateProvider(
  providerId: string,
  input: UpdateProviderConnectionInput,
  rowVersion: number
): Promise<ProviderConnectionDto> {
  return api.request<ProviderConnectionDto>(`/api/v1/providers/${encodeURIComponent(providerId)}`, {
    method: 'PATCH',
    body: input,
    ifMatch: rowVersion
  })
}

export function testProviderConnection(
  providerId: string,
  input: ProviderProbeInput,
  signal?: AbortSignal
): Promise<ProviderProbeDto> {
  return api.request<ProviderProbeDto>(`/api/v1/providers/${encodeURIComponent(providerId)}/test`, {
    method: 'POST',
    body: input,
    ...withSignal(signal)
  })
}

export async function listBackups(characterId: string, signal?: AbortSignal): Promise<CharacterBackupDto[]> {
  const response = await api.request<ItemsResponse<CharacterBackupDto>>(
    `/api/v1/characters/${encodeURIComponent(characterId)}/backups`,
    withSignal(signal)
  )
  return response.items
}

export function getBackup(backupId: string, signal?: AbortSignal): Promise<CharacterBackupDto> {
  return api.request<CharacterBackupDto>(
    `/api/v1/backups/${encodeURIComponent(backupId)}`,
    withSignal(signal)
  )
}

export function createBackup(
  characterId: string,
  idempotencyKey = newIdempotencyKey()
): Promise<CharacterBackupDto> {
  return api.request<CharacterBackupDto>(`/api/v1/characters/${encodeURIComponent(characterId)}/backups`, {
    method: 'POST',
    body: {},
    idempotencyKey
  })
}

export function downloadBackup(backupId: string, signal?: AbortSignal): Promise<Blob> {
  return api.requestBlob(`/api/v1/backups/${encodeURIComponent(backupId)}/download`, {
    ...withSignal(signal),
    accept: 'application/zip'
  })
}
