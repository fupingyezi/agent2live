import { ApiClient, newIdempotencyKey } from './client'
import type {
  ArtProjectDto,
  CharacterDto,
  CharacterLineageDto,
  CreateArtProjectInput,
  CreateCharacterInput,
  ItemsResponse,
  JobDto,
  JobEventDto
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
