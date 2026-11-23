import type {
  ArtProjectDto as ContractArtProjectDto,
  ArtVersionDto as ContractArtVersionDto,
  ArtVersionListDto as ContractArtVersionListDto,
  ArtVersionMutationDto as ContractArtVersionMutationDto,
  AssetDto as ContractAssetDto,
  CharacterBackupDto as ContractCharacterBackupDto,
  CharacterDto as ContractCharacterDto,
  CharacterLineageDto as ContractCharacterLineageDto,
  CreateGenerationResultDto as ContractCreateGenerationResultDto,
  ForkLinkDto as ContractForkLinkDto,
  ForkLinkMutationDto as ContractForkLinkMutationDto,
  ForkResultDto as ContractForkResultDto,
  GenerationCandidateDto as ContractGenerationCandidateDto,
  GenerationDto as ContractGenerationDto,
  JobDto as ContractJobDto,
  JobEventDto as ContractJobEventDto,
  LineageNodeDto as ContractLineageNodeDto,
  PromptDraftDto as ContractPromptDraftDto,
  PromptInputMaterialDto as ContractPromptInputMaterialDto,
  PromptInputResult as ContractPromptInputResult,
  PromptInputSubmissionDto as ContractPromptInputSubmissionDto,
  PromptReference as ContractPromptReference,
  PromptReverseResultDto as ContractPromptReverseResultDto,
  PromptSuggestionDto as ContractPromptSuggestionDto,
  PromptSyncInput as ContractPromptSyncInput,
  PromptSyncResultDto as ContractPromptSyncResultDto,
  PromptVersionDto as ContractPromptVersionDto,
  PromptVersionSummary as ContractPromptVersionSummary,
  PromptWorkspaceDto as ContractPromptWorkspaceDto,
  ProviderConnectionDto as ContractProviderConnectionDto,
  ProviderModelProfile as ContractProviderModelProfile,
  ProviderModelSelection as ContractProviderModelSelection,
  ProviderProbeDto as ContractProviderProbeDto
} from '@agent2live/contracts'

export type {
  ArtProjectStage,
  CreateArtProjectInput,
  CreateCharacterInput,
  CreateForkInput,
  ErrorCategory,
  ErrorSeverity,
  FieldError,
  JobStatus,
  MaterialRole,
  PatchForkInput,
  ProblemDetails,
  PromptBlock,
  PromptMaterialRef,
  PromptOperation,
  PromptReference,
  PromptReferenceRole,
  PromptRequirement,
  PromptSpecV2,
  PromptReverseResultStatus,
  PromptSuggestionStatus,
  UserAction
} from '@agent2live/contracts'

type TimestampKey =
  | 'createdAt'
  | 'updatedAt'
  | 'deletedAt'
  | 'completedAt'
  | 'startedAt'
  | 'finishedAt'
  | 'cancelRequestedAt'
  | 'nextAttemptAt'
  | 'detachedAt'
  | 'expiresAt'
  | 'acceptedAt'
  | 'activatedAt'
  | 'appliedAt'
  | 'resolvedAt'
  | 'discardedAt'
  | 'publishedAt'
  | 'lastSeenAt'
  | 'checkedAt'
  | 'modelsRefreshedAt'

type IsoTimestamp<T> = T extends number ? string : T extends number | null ? string | null : T

/** Converts whitelisted millisecond fields to RFC 3339 strings at every nesting level. */
export type WithIsoTimestamps<T> = T extends string | number | boolean | bigint | symbol | null | undefined
  ? T
  : T extends ReadonlyArray<infer U>
    ? Array<WithIsoTimestamps<U>>
    : T extends object
      ? {
          [K in keyof T]: K extends TimestampKey ? IsoTimestamp<T[K]> : WithIsoTimestamps<T[K]>
        }
      : T

// The API boundary serializes whitelisted millisecond fields as RFC 3339 strings.
// View models stay derived from wire contracts so any new field is reflected automatically.
export type CharacterDto = WithIsoTimestamps<ContractCharacterDto>
export type ArtProjectDto = WithIsoTimestamps<ContractArtProjectDto>
export type ForkLinkDto = WithIsoTimestamps<ContractForkLinkDto>
export type JobDto = WithIsoTimestamps<ContractJobDto>
export type JobEventDto = WithIsoTimestamps<ContractJobEventDto>
export type AssetDto = WithIsoTimestamps<ContractAssetDto>
export type ProviderConnectionDto = WithIsoTimestamps<ContractProviderConnectionDto>
export type ProviderProbeDto = WithIsoTimestamps<ContractProviderProbeDto>
export type ProviderModelProfile = ContractProviderModelProfile
export type ProviderModelSelection = ContractProviderModelSelection
export type CharacterBackupDto = WithIsoTimestamps<ContractCharacterBackupDto>

export type PromptDraftDto = WithIsoTimestamps<ContractPromptDraftDto>
export type PromptInputMaterialDto = WithIsoTimestamps<ContractPromptInputMaterialDto>
export type PromptInputSubmissionDto = WithIsoTimestamps<ContractPromptInputSubmissionDto>
export type PromptVersionSummaryDto = WithIsoTimestamps<ContractPromptVersionSummary>
export type PromptVersionDto = WithIsoTimestamps<ContractPromptVersionDto>
export type PromptReferenceDto = WithIsoTimestamps<ContractPromptReference>
export type PromptWorkspaceDto = WithIsoTimestamps<ContractPromptWorkspaceDto>
export type SubmitPromptInputResult = WithIsoTimestamps<ContractPromptInputResult>
export type PromptReverseResultDto = WithIsoTimestamps<ContractPromptReverseResultDto>
export type PromptSuggestionDto = WithIsoTimestamps<ContractPromptSuggestionDto>
export type PromptSyncInput = ContractPromptSyncInput
export type PromptSyncResultDto = ContractPromptSyncResultDto
export type ArtVersionDto = WithIsoTimestamps<ContractArtVersionDto>
export type ArtVersionListDto = WithIsoTimestamps<ContractArtVersionListDto>
export type ArtVersionMutationDto = WithIsoTimestamps<ContractArtVersionMutationDto>
export type GenerationCandidateDto = WithIsoTimestamps<ContractGenerationCandidateDto>
export type GenerationDto = WithIsoTimestamps<ContractGenerationDto>
export type CreateGenerationResultDto = WithIsoTimestamps<ContractCreateGenerationResultDto>
export type ForkResultDto = WithIsoTimestamps<ContractForkResultDto>
export type ForkLinkMutationDto = WithIsoTimestamps<ContractForkLinkMutationDto>

export type LineageNodeDto = Omit<ContractLineageNodeDto, 'artProject' | 'fork' | 'children'> & {
  artProject: ArtProjectDto
  fork: ForkLinkDto | null
  children: LineageNodeDto[]
}

export type CharacterLineageDto = Omit<ContractCharacterLineageDto, 'roots'> & {
  roots: LineageNodeDto[]
}

export interface ItemsResponse<T> {
  items: T[]
}
