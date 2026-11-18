import React from 'react'
import type {
  ArtProjectDto,
  ArtVersionDto,
  GenerationDto,
  PromptVersionDto,
  PromptVersionSummaryDto
} from '@studio/api'
import type { PromptSpecV2 } from '@studio/api'
import type { PromptFilter } from '../prompt-diagnostics'
import { PromptEditorCard } from '../components/prompt/PromptEditorCard'
import { VersionOverviewCard } from '../components/prompt/VersionOverviewCard'

export interface PromptWorkbenchViewProps {
  project: ArtProjectDto
  characterTitle: string
  characterSummary: string | null
  promptVersion: PromptVersionDto | null
  promptVersions: PromptVersionSummaryDto[]
  artVersions: ArtVersionDto[]
  spec: PromptSpecV2 | null
  referenceCount: number
  readOnly: boolean
  dirty: boolean
  canCommit: boolean
  filter: PromptFilter
  latestGeneration: GenerationDto | null
  submitting: boolean
  error: string | null
  onFilterChange(filter: PromptFilter): void
  onRename(): void
  onOpenBlock(blockId: string, negative: boolean): void
  onNewBlock(negative: boolean): void
  onOpenAiRewrite(intent: string): void
  onOpenReverse(): void
  onOpenFullPrompt(): void
  onOpenReferences(): void
  onOpenVersions(): void
  onSelectPromptVersion(versionId: string): void
  onRollbackToPromptVersion(versionId: string): void
  onViewArtVersion(versionId: string): void
  onSubmitVersion(): void
}

export const PromptWorkbenchView: React.FC<PromptWorkbenchViewProps> = ({
  project,
  characterTitle,
  characterSummary,
  promptVersion,
  promptVersions,
  artVersions,
  spec,
  referenceCount,
  readOnly,
  dirty,
  canCommit,
  filter,
  latestGeneration,
  submitting,
  error,
  onFilterChange,
  onRename,
  onOpenBlock,
  onNewBlock,
  onOpenAiRewrite,
  onOpenReverse,
  onOpenFullPrompt,
  onOpenReferences,
  onOpenVersions,
  onSelectPromptVersion,
  onRollbackToPromptVersion,
  onViewArtVersion,
  onSubmitVersion
}) => {
  return (
    <div className="wb3-prompt-layout" data-testid="wb3-prompt-view">
      <PromptEditorCard
        characterTitle={characterTitle}
        characterSummary={characterSummary}
        spec={spec}
        referenceCount={referenceCount}
        readOnly={readOnly}
        dirty={dirty}
        canCommit={canCommit}
        filter={filter}
        droppedBlockIds={latestGeneration?.droppedBlockIds ?? []}
        submitting={submitting}
        error={error}
        onFilterChange={onFilterChange}
        onRename={onRename}
        onOpenBlock={onOpenBlock}
        onNewBlock={onNewBlock}
        onOpenAiRewrite={onOpenAiRewrite}
        onOpenReverse={onOpenReverse}
        onOpenFullPrompt={onOpenFullPrompt}
        onSubmitVersion={onSubmitVersion}
      />
      <VersionOverviewCard
        project={project}
        promptVersion={promptVersion}
        promptVersions={promptVersions}
        artVersions={artVersions}
        onOpenReferences={onOpenReferences}
        onOpenVersions={onOpenVersions}
        onSelectPromptVersion={onSelectPromptVersion}
        onRollback={onRollbackToPromptVersion}
        onViewArtVersion={onViewArtVersion}
      />
    </div>
  )
}
