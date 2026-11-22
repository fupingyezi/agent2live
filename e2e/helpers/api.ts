import type { ProviderModelProfile } from '../../packages/contracts/src/provider-catalog'
import type { EndpointInfo } from './app'

export interface AssetDto {
  id: string
  sha256: string
  mediaType: string
  byteSize: number
  width: number | null
  height: number | null
  createdAt: string
}

export interface CharacterDto {
  id: string
  title: string
  summary: string | null
  createdAt: string
  updatedAt: string
  rowVersion: number
}

export interface ArtProjectDto {
  id: string
  characterId: string
  title: string
  description: string | null
  stage: string
  activeVersionId: string | null
  activePromptVersionId: string | null
  rowVersion: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  forkedFrom: {
    forkId: string
    parentProjectId: string
    rootProjectId: string
    sourceKind: 'prompt_version' | 'art_version'
    sourceVersionId: string
    branchLabel: string
    status: 'active' | 'detached'
    parentDeleted: boolean
  } | null
}

export interface PromptInputSubmissionDto {
  id: string
  artProjectId: string
  draftId: string
  revision: number
  characterBriefVersionId: string | null
  globalNotes: string
  requirements: Array<{ id: string; text: string; strength: string }>
  materials: Array<{
    id: string
    assetId: string
    role: string
    note: string
    weight: number
    locked: boolean
    sortOrder: number
  }>
}

export interface PromptDraftDto {
  id: string
  artProjectId: string
  revision: number
  status: string
  state: Record<string, unknown>
  contentHash: string
  inputSubmissionId: string | null
  baseVersionId: string | null
  rowVersion: number
  updatedAt: string
}

export interface PromptReferenceDto {
  assetId: string
  role: string
  note: string
  weight: number
  locked: boolean
}

export interface PromptVersionDto {
  id: string
  artProjectId: string
  versionNumber: number
  parentVersionId: string | null
  inputSubmissionId: string
  state: Record<string, unknown>
  references: PromptReferenceDto[]
  contentHash: string
  createdAt: string
}

export interface PromptInputResult {
  submission: PromptInputSubmissionDto
  draft: PromptDraftDto
  warnings: string[]
}

export interface CommitPromptResult {
  version: PromptVersionDto
  project: ArtProjectDto
}

export interface ProviderConnectionDto {
  id: string
  label: string
  kind: 'chat' | 'image'
  adapter: 'openai-compatible' | 'seedream' | 'mock'
  baseUrl: string | null
  model: string | null
  enabled: boolean
  capabilities: unknown
  models: ProviderModelProfile[]
  modelsRefreshedAt: number | null
  hasSecret: boolean
  createdAt: number
  updatedAt: number
  rowVersion: number
}

export interface GenerationCandidateDto {
  id: string
  generationJobId: string
  assetId: string
  asset: AssetDto | null
  status: 'ready' | 'accepted' | 'rejected' | 'expired'
  validation: Record<string, unknown>
  acceptedArtVersionId: string | null
  createdAt: string
}

export interface GenerationDto {
  id: string
  artProjectId: string
  promptVersionId: string
  baseArtVersionId: string | null
  providerConnectionId: string | null
  jobId: string
  status: string
  attempts: number
  errorCode: string | null
  progress: number | null
  request: Record<string, unknown>
  requestHash: string
  candidates: GenerationCandidateDto[]
  createdAt: string
  updatedAt: string
}

export interface JobDto {
  id: string
  type: string
  status:
    | 'queued'
    | 'leased'
    | 'running'
    | 'waiting_user'
    | 'succeeded'
    | 'failed'
    | 'retrying'
    | 'cancelled'
    | 'unknown_outcome'
  attempts: number
  maxAttempts: number
  progress: number | null
  errorCode: string | null
  result: unknown
  createdAt: string
  updatedAt: string
}

export interface ArtVersionDto {
  id: string
  artProjectId: string
  versionNumber: number
  artworkAssetId: string
  promptVersionId: string
  generationJobId: string | null
  parentVersionId: string | null
  originVersionId: string | null
  sourceKind: 'generated' | 'manual_upload' | 'fork_seed'
  source: Record<string, unknown>
  validation: Record<string, unknown>
  canvasTransform: Record<string, unknown>
  contentHash: string
  createdAt: string
}

export interface ArtVersionMutationDto {
  artVersion: ArtVersionDto
  project: ArtProjectDto
}

export interface ArtVersionListDto {
  items: ArtVersionDto[]
  activeVersionId: string | null
}

export interface ForkResultDto {
  fork: {
    id: string
    childProjectId: string
    parentProjectId: string
    rootProjectId: string
    sourceKind: 'prompt_version' | 'art_version'
    sourceVersionId: string
    sourceHash: string
    branchLabel: string
    status: 'active' | 'detached'
  }
  childProject: ArtProjectDto
  seedPromptVersion: PromptVersionDto
  seedArtVersion: ArtVersionDto | null
}

export interface CharacterBackupDto {
  id: string
  characterId: string
  jobId: string
  formatVersion: 1
  status: string
  createdAt: string
  completedAt: string | null
  fileSize: number | null
  sha256: string | null
  downloadPath: string | null
  errorCode: string | null
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly problem: Record<string, unknown>
  ) {
    super(`${status} ${code}: ${typeof problem.title === 'string' ? problem.title : 'request failed'}`)
    this.name = 'ApiError'
  }
}

export interface JsonResponse<T> {
  status: number
  headers: Headers
  body: T
}

type JsonBody = Record<string, unknown>

let keySequence = 0
export function uniqueKey(prefix: string): string {
  keySequence += 1
  return `${prefix}-${Date.now().toString(36)}-${keySequence}`
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function decodeProblem(text: string, status: number): { code: string; problem: Record<string, unknown> } {
  try {
    const problem = JSON.parse(text) as Record<string, unknown>
    return {
      code: typeof problem.code === 'string' ? problem.code : `HTTP_${status}`,
      problem
    }
  } catch {
    return { code: `HTTP_${status}`, problem: { title: text.slice(0, 300) } }
  }
}

export class ApiClient {
  constructor(private readonly endpoint: EndpointInfo) {}

  private url(path: string): URL {
    return new URL(path, this.endpoint.baseUrl)
  }

  async json<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    options: { body?: JsonBody; headers?: Record<string, string> } = {}
  ): Promise<JsonResponse<T>> {
    const headers = new Headers(options.headers)
    headers.set('authorization', `Bearer ${this.endpoint.token}`)
    headers.set('accept', 'application/json')
    const init: RequestInit = { method, headers }
    if (options.body !== undefined) {
      headers.set('content-type', 'application/json')
      init.body = JSON.stringify(options.body)
    }
    const response = await fetch(this.url(path), init)
    const text = await response.text()
    if (!response.ok) {
      const decoded = decodeProblem(text, response.status)
      throw new ApiError(response.status, decoded.code, decoded.problem)
    }
    return {
      status: response.status,
      headers: response.headers,
      body: (text ? JSON.parse(text) : undefined) as T
    }
  }

  async bytes(
    path: string,
    accept = 'application/octet-stream'
  ): Promise<{
    status: number
    headers: Headers
    bytes: Buffer
  }> {
    const response = await fetch(this.url(path), {
      headers: {
        authorization: `Bearer ${this.endpoint.token}`,
        accept
      }
    })
    if (!response.ok) {
      const text = await response.text()
      const decoded = decodeProblem(text, response.status)
      throw new ApiError(response.status, decoded.code, decoded.problem)
    }
    return {
      status: response.status,
      headers: response.headers,
      bytes: Buffer.from(await response.arrayBuffer())
    }
  }

  async uploadAsset(bytes: Uint8Array, mediaType = 'image/png', filename = 'asset.png'): Promise<AssetDto> {
    const form = new FormData()
    form.append('file', new Blob([toArrayBuffer(bytes)], { type: mediaType }), filename)
    const response = await fetch(this.url('/api/v1/assets'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.endpoint.token}`,
        accept: 'application/json'
      },
      body: form
    })
    const text = await response.text()
    if (!response.ok) {
      const decoded = decodeProblem(text, response.status)
      throw new ApiError(response.status, decoded.code, decoded.problem)
    }
    return JSON.parse(text) as AssetDto
  }

  async createCharacter(title: string, summary = ''): Promise<CharacterDto> {
    const response = await this.json<CharacterDto>('POST', '/api/v1/characters', {
      body: summary ? { title, summary } : { title }
    })
    return response.body
  }

  async createProject(characterId: string, title: string, description?: string): Promise<ArtProjectDto> {
    const response = await this.json<ArtProjectDto>(
      'POST',
      `/api/v1/characters/${encodeURIComponent(characterId)}/art-projects`,
      { body: description ? { title, description } : { title } }
    )
    return response.body
  }

  async getProject(projectId: string): Promise<ArtProjectDto> {
    return (await this.json<ArtProjectDto>('GET', `/api/v1/art-projects/${encodeURIComponent(projectId)}`))
      .body
  }

  async getCharacter(characterId: string): Promise<CharacterDto> {
    return (await this.json<CharacterDto>('GET', `/api/v1/characters/${encodeURIComponent(characterId)}`))
      .body
  }

  async uploadPromptInput(
    projectId: string,
    pngBytes: Uint8Array,
    options: {
      ifMatchRowVersion?: number
      filename?: string
      characterBrief?: Record<string, unknown>
    } = {}
  ): Promise<PromptInputResult> {
    const metadata = {
      ...(options.characterBrief ? { characterBrief: options.characterBrief } : {}),
      globalNotes: 'Golden Chain 的确定性测试输入。',
      requirements: [
        { id: 'req_identity', text: '银白长发与蓝色眼睛', strength: 'must' },
        { id: 'req_style', text: '清爽赛璐璐', strength: 'prefer' },
        { id: 'req_avoid', text: '避免写实皮肤', strength: 'avoid' }
      ],
      materials: [
        {
          partName: 'face-reference',
          fileField: 'file_face',
          role: 'identity_reference',
          note: '脸型与发色参考',
          weight: 1,
          locked: true,
          sortOrder: 0
        }
      ]
    }
    const form = new FormData()
    // A Blob part gets filename "blob" and would arrive as a file part; the
    // server requires metadata to be a plain multipart field.
    form.append('metadata', JSON.stringify(metadata))
    form.append(
      'file_face',
      new Blob([toArrayBuffer(pngBytes)], { type: 'image/png' }),
      options.filename ?? 'face-reference.png'
    )
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.endpoint.token}`,
      accept: 'application/json'
    }
    if (options.ifMatchRowVersion !== undefined) {
      headers['if-match'] = `"${options.ifMatchRowVersion}"`
    }
    const response = await fetch(
      this.url(`/api/v1/art-projects/${encodeURIComponent(projectId)}/prompt-inputs`),
      { method: 'POST', headers, body: form }
    )
    const text = await response.text()
    if (!response.ok) {
      const decoded = decodeProblem(text, response.status)
      throw new ApiError(response.status, decoded.code, decoded.problem)
    }
    return JSON.parse(text) as PromptInputResult
  }

  async savePromptDraft(
    projectId: string,
    draftId: string,
    state: Record<string, unknown>,
    expectedRowVersion: number
  ): Promise<PromptDraftDto> {
    const response = await this.json<PromptDraftDto>(
      'PATCH',
      `/api/v1/art-projects/${encodeURIComponent(projectId)}/prompt-drafts/${encodeURIComponent(draftId)}`,
      {
        body: { state },
        headers: { 'if-match': `"${expectedRowVersion}"` }
      }
    )
    return response.body
  }

  async commitPromptDraft(
    projectId: string,
    draftId: string,
    expectedRowVersion: number,
    idempotencyKey = uniqueKey('commit')
  ): Promise<CommitPromptResult> {
    const response = await this.json<CommitPromptResult>(
      'POST',
      `/api/v1/art-projects/${encodeURIComponent(projectId)}/prompt-drafts/${encodeURIComponent(draftId)}/commit`,
      {
        body: { acknowledgeUncoveredRequirements: true },
        headers: {
          'if-match': `"${expectedRowVersion}"`,
          'idempotency-key': idempotencyKey
        }
      }
    )
    return response.body
  }

  async createMockImageProvider(label = 'Golden Chain Mock 生图'): Promise<ProviderConnectionDto> {
    const response = await this.json<ProviderConnectionDto>('POST', '/api/v1/providers', {
      headers: { 'idempotency-key': uniqueKey('provider-mock') },
      body: {
        label,
        kind: 'image',
        adapter: 'mock',
        capabilities: {
          schemaVersion: 'provider-capabilities/1',
          image: {
            maxReferenceImages: 4,
            maxPromptChars: 20_000,
            supportsNegativePrompt: true,
            supportsWeightSyntax: true,
            supportsSeed: true,
            maxCount: 4,
            sizes: ['512x896', '1024x1792']
          }
        }
      }
    })
    return response.body
  }

  async createMockChatProvider(label = 'Mock 对话'): Promise<ProviderConnectionDto> {
    const response = await this.json<ProviderConnectionDto>('POST', '/api/v1/providers', {
      headers: { 'idempotency-key': uniqueKey('provider-mock') },
      body: {
        label,
        kind: 'chat',
        adapter: 'mock',
        capabilities: {
          schemaVersion: 'provider-capabilities/1',
          chat: { maxImages: 8, maxPromptChars: 20_000, supportsVision: true }
        }
      }
    })
    return response.body
  }

  async createGeneration(input: {
    projectId: string
    promptVersionId: string
    baseArtVersionId?: string | null
    providerConnectionId: string
    modelId?: string
    count?: number
    size?: string
    seed?: number
  }): Promise<{ generationId: string; jobId: string; requestHash: string }> {
    const response = await this.json<{ generationId: string; jobId: string; requestHash: string }>(
      'POST',
      `/api/v1/art-projects/${encodeURIComponent(input.projectId)}/generations`,
      {
        headers: { 'idempotency-key': uniqueKey('generation') },
        body: {
          promptVersionId: input.promptVersionId,
          ...(input.baseArtVersionId === undefined ? {} : { baseArtVersionId: input.baseArtVersionId }),
          providerConnectionId: input.providerConnectionId,
          ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
          count: input.count ?? 1,
          size: input.size ?? '512x896',
          seed: input.seed ?? 20261109
        }
      }
    )
    return response.body
  }

  async getGeneration(generationId: string): Promise<GenerationDto> {
    return (await this.json<GenerationDto>('GET', `/api/v1/generations/${encodeURIComponent(generationId)}`))
      .body
  }

  async getJob(jobId: string): Promise<JobDto> {
    return (await this.json<JobDto>('GET', `/api/v1/jobs/${encodeURIComponent(jobId)}`)).body
  }

  async waitForJob(jobId: string, timeoutMs = 60_000): Promise<JobDto> {
    const deadline = Date.now() + timeoutMs
    let last: JobDto | null = null
    while (Date.now() < deadline) {
      last = await this.getJob(jobId)
      if (last.status === 'succeeded') return last
      if (['failed', 'cancelled', 'unknown_outcome'].includes(last.status)) {
        throw new Error(`job ${jobId} ended as ${last.status} (${last.errorCode ?? 'no error code'})`)
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(
      `job ${jobId} did not finish within ${timeoutMs}ms; last status ${last?.status ?? 'unknown'}`
    )
  }

  async waitForGenerationReady(generationId: string, timeoutMs = 60_000): Promise<GenerationDto> {
    const deadline = Date.now() + timeoutMs
    let last: GenerationDto | null = null
    while (Date.now() < deadline) {
      last = await this.getGeneration(generationId)
      const ready = last.candidates.find((candidate) => candidate.status === 'ready')
      if (last.status === 'succeeded' && ready) return last
      if (['failed', 'cancelled', 'unknown_outcome'].includes(last.status)) {
        throw new Error(
          `generation ${generationId} ended as ${last.status} (${last.errorCode ?? 'no error code'})`
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(
      `generation ${generationId} did not become ready within ${timeoutMs}ms; last status ${last?.status ?? 'unknown'}`
    )
  }

  async getArtVersions(projectId: string): Promise<ArtVersionListDto> {
    return (
      await this.json<ArtVersionListDto>(
        'GET',
        `/api/v1/art-projects/${encodeURIComponent(projectId)}/art-versions`
      )
    ).body
  }

  async acceptCandidate(
    candidateId: string,
    expectedActiveArtVersionId: string | null
  ): Promise<ArtVersionMutationDto> {
    return (
      await this.json<ArtVersionMutationDto>(
        'POST',
        `/api/v1/generation-candidates/${encodeURIComponent(candidateId)}/accept`,
        {
          headers: { 'idempotency-key': uniqueKey('accept-candidate') },
          body: { expectedActiveArtVersionId }
        }
      )
    ).body
  }

  async createManualArtVersion(input: {
    projectId: string
    assetId: string
    promptVersionId: string
    expectedProjectRowVersion: number
  }): Promise<ArtVersionMutationDto> {
    return (
      await this.json<ArtVersionMutationDto>(
        'POST',
        `/api/v1/art-projects/${encodeURIComponent(input.projectId)}/art-versions/manual`,
        {
          headers: {
            'if-match': `"${input.expectedProjectRowVersion}"`,
            'idempotency-key': uniqueKey('manual-art')
          },
          body: {
            assetId: input.assetId,
            promptVersionId: input.promptVersionId
          }
        }
      )
    ).body
  }

  async activateArtVersion(input: {
    projectId: string
    versionId: string
    reason: 'switch' | 'rollback'
    expectedProjectRowVersion: number
  }): Promise<ArtVersionMutationDto> {
    return (
      await this.json<ArtVersionMutationDto>(
        'POST',
        `/api/v1/art-projects/${encodeURIComponent(input.projectId)}/art-versions/${encodeURIComponent(input.versionId)}/activate`,
        {
          headers: {
            'if-match': `"${input.expectedProjectRowVersion}"`,
            'idempotency-key': uniqueKey('activate-art')
          },
          body: { reason: input.reason }
        }
      )
    ).body
  }

  async forkFromArtVersion(input: {
    versionId: string
    title: string
    branchLabel: string
    description?: string
  }): Promise<ForkResultDto> {
    const body: JsonBody = { title: input.title, branchLabel: input.branchLabel }
    if (input.description) body.description = input.description
    return (
      await this.json<ForkResultDto>(
        'POST',
        `/api/v1/art-versions/${encodeURIComponent(input.versionId)}/forks`,
        {
          headers: { 'idempotency-key': uniqueKey('fork-art') },
          body
        }
      )
    ).body
  }

  async createBackup(characterId: string): Promise<CharacterBackupDto> {
    return (
      await this.json<CharacterBackupDto>(
        'POST',
        `/api/v1/characters/${encodeURIComponent(characterId)}/backups`,
        {
          headers: { 'idempotency-key': uniqueKey('backup') },
          body: {}
        }
      )
    ).body
  }

  async getBackup(backupId: string): Promise<CharacterBackupDto> {
    return (await this.json<CharacterBackupDto>('GET', `/api/v1/backups/${encodeURIComponent(backupId)}`))
      .body
  }

  async waitForBackup(backupId: string, timeoutMs = 60_000): Promise<CharacterBackupDto> {
    const deadline = Date.now() + timeoutMs
    let last: CharacterBackupDto | null = null
    while (Date.now() < deadline) {
      last = await this.getBackup(backupId)
      if (last.status === 'succeeded') return last
      if (last.status === 'failed' || last.status === 'cancelled') {
        throw new Error(`backup ${backupId} ended as ${last.status} (${last.errorCode ?? 'no error code'})`)
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(
      `backup ${backupId} did not succeed within ${timeoutMs}ms; last status ${last?.status ?? 'unknown'}`
    )
  }

  async downloadBackup(backupId: string): Promise<{
    bytes: Buffer
    contentType: string | null
    contentDisposition: string | null
    contentLength: string | null
  }> {
    const response = await this.bytes(
      `/api/v1/backups/${encodeURIComponent(backupId)}/download`,
      'application/zip'
    )
    return {
      bytes: response.bytes,
      contentType: response.headers.get('content-type'),
      contentDisposition: response.headers.get('content-disposition'),
      contentLength: response.headers.get('content-length')
    }
  }
}
