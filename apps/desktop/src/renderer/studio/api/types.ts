import type {
  ArtProjectDto as ContractArtProjectDto,
  AssetDto as ContractAssetDto,
  CharacterDto as ContractCharacterDto,
  CharacterLineageDto as ContractCharacterLineageDto,
  ForkLinkDto as ContractForkLinkDto,
  JobDto as ContractJobDto,
  JobEventDto as ContractJobEventDto,
  LineageNodeDto as ContractLineageNodeDto,
  ProviderConnectionDto as ContractProviderConnectionDto
} from '@agent2live/contracts'

export type {
  ArtProjectStage,
  CreateArtProjectInput,
  CreateCharacterInput,
  ErrorCategory,
  ErrorSeverity,
  FieldError,
  JobStatus,
  ProblemDetails,
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

type IsoTimestamp<T> = T extends number ? string : T extends number | null ? string | null : T

type WithIsoTimestamps<T> = {
  [K in keyof T]: K extends TimestampKey ? IsoTimestamp<T[K]> : T[K]
}

// The API boundary serializes whitelisted millisecond fields as RFC 3339 strings.
// View models stay derived from wire contracts so any new field is reflected automatically.
export type CharacterDto = WithIsoTimestamps<ContractCharacterDto>
export type ArtProjectDto = WithIsoTimestamps<ContractArtProjectDto>
export type ForkLinkDto = WithIsoTimestamps<ContractForkLinkDto>
export type JobDto = WithIsoTimestamps<ContractJobDto>
export type JobEventDto = WithIsoTimestamps<ContractJobEventDto>
export type AssetDto = WithIsoTimestamps<ContractAssetDto>
export type ProviderConnectionDto = WithIsoTimestamps<ContractProviderConnectionDto>

export type LineageNodeDto = Omit<ContractLineageNodeDto, 'project' | 'fork' | 'children'> & {
  project: ArtProjectDto
  fork: ForkLinkDto | null
  children: LineageNodeDto[]
}

export type CharacterLineageDto = Omit<ContractCharacterLineageDto, 'roots'> & {
  roots: LineageNodeDto[]
}

export interface ItemsResponse<T> {
  items: T[]
}
