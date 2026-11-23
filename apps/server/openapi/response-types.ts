// Docs-only response shapes. Complex Zod-inferred fields are `unknown` here and
// replaced by the schema registry's Zod overrides; this keeps ts-json-schema-generator
// away from `z.infer` types while preserving accurate OpenAPI models.

export type JobStatus =
  | 'queued'
  | 'leased'
  | 'running'
  | 'waiting_user'
  | 'succeeded'
  | 'failed'
  | 'retrying'
  | 'cancelled'
  | 'unknown_outcome'

export type ArtProjectStage =
  | 'idea_draft'
  | 'prompt_draft'
  | 'prompt_ready'
  | 'generating'
  | 'candidate_review'
  | 'art_version_active'
  | 'live2d_pending'
  | 'blocked'

export interface CharacterDto {
  id: string
  title: string
  summary: string | null
  activeBriefVersionId: string | null
  createdAt: number
  updatedAt: number
  rowVersion: number
}

export interface CharacterBriefVersion {
  id: string
  characterId: string
  parentVersionId: string | null
  schemaVersion: 'character-brief/1'
  content: unknown
  contentHash: string
  sourceKind: 'user' | 'imported' | 'derived_confirmed'
  createdAt: number
}

export interface ArtProjectForkSlice {
  forkId: string
  parentArtProjectId: string
  rootArtProjectId: string
  sourceKind: 'prompt_version' | 'art_version'
  sourceVersionId: string
  branchLabel: string
  status: 'active' | 'detached'
  parentDeleted: boolean
}

export interface ArtProjectDto {
  id: string
  characterId: string
  title: string
  description: string | null
  stage: ArtProjectStage
  activeVersionId: string | null
  activePromptVersionId: string | null
  forkedFrom: ArtProjectForkSlice | null
  createdAt: number
  updatedAt: number
  rowVersion: number
  deletedAt: number | null
}

export interface ForkLinkDto {
  id: string
  childArtProjectId: string
  parentArtProjectId: string
  rootArtProjectId: string
  sourceKind: 'prompt_version' | 'art_version'
  sourceVersionId: string
  sourceHash: string
  branchLabel: string
  status: 'active' | 'detached'
  createdAt: number
  detachedAt: number | null
}

export interface LineageNodeDto {
  artProject: ArtProjectDto
  fork: ForkLinkDto | null
  parentDeleted: boolean
  children: LineageNodeDto[]
}

export interface CharacterLineageDto {
  characterId: string
  roots: LineageNodeDto[]
}

export interface JobDto {
  id: string
  type: string
  status: JobStatus
  attempts: number
  maxAttempts: number
  progress: number | null
  errorCode: string | null
  errorMessage: string | null
  result: unknown
  cancelRequested: boolean
  createdAt: number
  updatedAt: number
}

export interface JobEventDto {
  id: string
  seq: number
  type: 'log' | 'progress' | 'done' | 'error'
  payload: unknown
  createdAt: number
}

export interface AssetDto {
  id: string
  sha256: string
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
  byteSize: number
  width: number | null
  height: number | null
  createdAt: number
}

export interface ProviderModelProfile {
  id: string
  name: string | null
  kind: 'chat' | 'image'
  adapter: 'openai-compatible' | 'seedream' | 'mock'
  capabilities: unknown
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

export interface ProviderModelListDto {
  items: ProviderModelProfile[]
}

export interface ProviderProbeDto {
  ok: true
  kind: 'chat' | 'image'
  adapter: 'openai-compatible' | 'seedream' | 'mock'
  model: string | null
  latencyMs: number
  checkedAt: number
  billable: boolean
}

export interface PromptDraftDto {
  id: string
  artProjectId: string
  revision: number
  status: 'active' | 'committed' | 'superseded'
  state: unknown
  contentHash: string
  inputSubmissionId: string | null
  baseVersionId: string | null
  rowVersion: number
  updatedAt: number
}

export interface PromptInputMaterialDto {
  id: string
  assetId: string
  role: string
  note: string
  weight: number
  locked: boolean
  sortOrder: number
}

export interface PromptInputSubmissionDto {
  id: string
  artProjectId: string
  draftId: string
  revision: number
  characterBriefVersionId: string | null
  globalNotes: string
  requirements: unknown[]
  materials: PromptInputMaterialDto[]
}

export interface PromptVersionSummary {
  id: string
  versionNumber: number
  parentVersionId: string | null
  contentHash: string
  createdAt: number
}

export interface PromptVersionDto extends PromptVersionSummary {
  artProjectId: string
  inputSubmissionId: string
  characterBriefVersionId: string | null
  state: unknown
  references: unknown[]
}

export interface PromptWorkspaceDto {
  artProjectId: string
  activeDraft: PromptDraftDto | null
  activePromptVersion: PromptVersionDto | null
  latestSubmission: PromptInputSubmissionDto | null
  versions: PromptVersionSummary[]
}

export interface PromptInputResult {
  submission: PromptInputSubmissionDto
  draft: PromptDraftDto
  warnings: string[]
}

export interface PromptReverseResultDto {
  id: string
  jobId: string
  artProjectId: string
  inputSubmissionId: string
  baseDraftId: string
  baseDraftRevision: number
  baseDraftRowVersion: number
  baseContentHash: string
  state: unknown | null
  contentHash: string
  status: 'ready' | 'applied' | 'discarded'
  createdAt: number
}

export interface PromptSuggestionDto {
  id: string
  artProjectId: string
  jobId: string
  baseKind: 'prompt_version' | 'prompt_draft'
  baseVersionId: string | null
  baseDraftId: string | null
  baseDraftRevision: number | null
  baseDraftRowVersion: number | null
  baseContentHash: string
  operations: unknown[]
  warnings: string[]
  intent: string
  status: 'proposed' | 'accepted' | 'rejected' | 'stale'
  acceptedDraftId: string | null
  acceptedDraftRevision: number | null
  createdAt: number
  resolvedAt: number | null
}

export interface ArtVersionDto {
  id: string
  artProjectId: string
  versionNumber: number
  artworkAssetId: string
  promptVersionId: string
  generationId: string | null
  parentVersionId: string | null
  originVersionId: string | null
  sourceKind: 'generated' | 'manual_upload' | 'fork_seed'
  source: unknown
  validation: unknown
  canvasTransform: unknown
  contentHash: string
  createdAt: number
}

export interface ArtVersionListDto {
  items: ArtVersionDto[]
  activeVersionId: string | null
}

export interface ArtVersionMutationDto {
  artVersion: ArtVersionDto
  artProject: ArtProjectDto
}

export interface GenerationCandidateDto {
  id: string
  generationId: string
  assetId: string
  asset: AssetDto | null
  status: 'ready' | 'accepted' | 'rejected' | 'expired'
  validation: unknown
  acceptedArtVersionId: string | null
  createdAt: number
}

export interface GenerationDto {
  id: string
  artProjectId: string
  promptVersionId: string
  baseArtVersionId: string | null
  providerConnectionId: string | null
  modelId: string | null
  jobId: string
  status: JobStatus
  attempts: number
  errorCode: string | null
  errorMessage: string | null
  progress: number | null
  count: number
  size: string
  seed: number | null
  droppedBlockIds: string[]
  compiledWarnings: string[]
  request: unknown
  requestHash: string
  candidates: GenerationCandidateDto[]
  createdAt: number
  updatedAt: number
}

export interface GenerationCreateResult {
  generationId: string
  jobId: string
  requestHash: string
  baseArtVersionId: string | null
  referenceAssetIds: string[]
  references: unknown
  warnings: string[]
}

export interface ForkResultDto {
  fork: ForkLinkDto
  childArtProject: ArtProjectDto
  seedPromptVersion: PromptVersionDto
  seedArtVersion: ArtVersionDto | null
}

export interface ForkLinkMutationDto {
  fork: ForkLinkDto
  childArtProject: ArtProjectDto
}

export interface CharacterBackupDto {
  id: string
  characterId: string
  jobId: string
  formatVersion: 1
  status: JobStatus
  createdAt: number
  completedAt: number | null
  fileSize: number | null
  sha256: string | null
  downloadPath: string | null
  errorCode: string | null
}

export interface ProjectTreeDto {
  root: ArtProjectDto
  roots: ArtProjectDto[]
  children: ArtProjectDto[]
  forks: Array<{
    id: string
    childArtProjectId: string
    parentArtProjectId: string
    rootArtProjectId: string
    sourceKind: 'prompt_version' | 'art_version'
    sourceVersionId: string
    branchLabel: string
    status: 'active' | 'detached'
    parentDeleted: boolean
  }>
}

export interface FieldError {
  path: string
  code: string
  messageKey: string
}

export interface ProblemDetails {
  type: string
  title: string
  status: number
  detail: string
  instance: string
  schemaVersion: 'error/1'
  requestId: string
  traceId: string
  retryable: boolean
  retryAfterMs: number | null
  error: {
    code: string
    category: string
    severity: 'info' | 'warning' | 'error' | 'fatal'
    messageKey: string
    userAction: string
    details: unknown
    fieldErrors: FieldError[]
  }
  supportId: string
}

export interface HealthResponse {
  schemaVersion: 'health/1'
  ok: true
  pid: number
  uptimeMs: number
  startedAt: string
  runtime: { node: string; modules: string; electron: string | null }
  data: { db: boolean; events: boolean }
  db?: { schemaVersion: 'sqlite/1'; migration: string | null; wal: boolean; vectorDim: 768 }
}

export interface SseEvent {
  schemaVersion: 'event/1'
  seq: number
  type: string
  scope: { kind: 'project' | 'character' | 'job' | 'agent' | 'system'; id: string }
  payload: unknown
  requestId: string | null
  traceId: string | null
  createdAt: number
}

export interface CharacterListResponse {
  items: CharacterDto[]
}
export interface CharacterBriefVersionListResponse {
  characterId: string
  activeVersionId: string | null
  items: CharacterBriefVersion[]
}
export interface PromptCommitResult {
  version: PromptVersionDto
  artProject: ArtProjectDto
}
export interface PromptVersionListResponse {
  items: PromptVersionSummary[]
}
export interface PromptSyncStartResult {
  jobId: string
}
export interface PromptReverseStartResult {
  jobId: string
  baseDraftRevision: number
  baseDraftRowVersion: number
}
export interface PromptReverseResultListResponse {
  items: PromptReverseResultDto[]
}
export interface PromptReverseApplyResult {
  result: PromptReverseResultDto
  draft: PromptDraftDto
}
export interface PromptSuggestionStartResult {
  jobId: string
  baseContentHash: string
}
export interface PromptSuggestionAcceptResult {
  suggestion: PromptSuggestionDto
  draft: PromptDraftDto
}
export interface GenerationListResponse {
  items: GenerationDto[]
}
export interface JobEventListResponse {
  items: JobEventDto[]
}
export interface ProviderListResponse {
  items: ProviderConnectionDto[]
}
export interface CharacterBackupListResponse {
  items: CharacterBackupDto[]
}

export const responseTypeNames = [
  'HealthResponse',
  'SseEvent',
  'CharacterDto',
  'CharacterListResponse',
  'CharacterBriefVersion',
  'CharacterBriefVersionListResponse',
  'ArtProjectDto',
  'ProjectTreeDto',
  'CharacterLineageDto',
  'ForkResultDto',
  'ForkLinkMutationDto',
  'PromptInputResult',
  'PromptInputSubmissionDto',
  'PromptDraftDto',
  'PromptCommitResult',
  'PromptWorkspaceDto',
  'PromptVersionSummary',
  'PromptVersionListResponse',
  'PromptVersionDto',
  'PromptSyncStartResult',
  'PromptReverseStartResult',
  'PromptReverseResultDto',
  'PromptReverseResultListResponse',
  'PromptReverseApplyResult',
  'PromptSuggestionStartResult',
  'PromptSuggestionDto',
  'PromptSuggestionAcceptResult',
  'GenerationCreateResult',
  'GenerationDto',
  'GenerationCandidateDto',
  'GenerationListResponse',
  'ArtVersionDto',
  'ArtVersionListDto',
  'ArtVersionMutationDto',
  'JobDto',
  'JobEventDto',
  'JobEventListResponse',
  'ProviderConnectionDto',
  'ProviderModelProfile',
  'ProviderProbeDto',
  'ProviderModelListDto',
  'ProviderListResponse',
  'AssetDto',
  'CharacterBackupDto',
  'CharacterBackupListResponse',
  'ProblemDetails',
  'PromptSpecV2',
  'PromptReference',
  'PromptRequirement',
  'PromptOperation',
  'ProviderCapabilities',
  'GenerationRequestDisplay',
  'ReferencePlan'
] as const

export type ResponseTypeName = (typeof responseTypeNames)[number]
