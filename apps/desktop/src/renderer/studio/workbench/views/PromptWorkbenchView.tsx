import React from 'react'
import type {
  ArtProjectDto,
  ArtVersionDto,
  GenerationDto,
  PromptVersionDto,
  PromptVersionSummaryDto
} from '@studio/api'
import type { PromptSpecV2 } from '@studio/api'
import { Button } from '@agent2live/design-system'
import type { PromptFilter } from '../prompt-diagnostics'
import { blockLabelById } from '../prompt-diagnostics'
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
  busy: boolean
  filter: PromptFilter
  latestGeneration: GenerationDto | null
  promptVersionError: string | null
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
  onRegenerate(): void
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
  busy,
  filter,
  latestGeneration,
  promptVersionError,
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
  onRegenerate,
  onRollbackToPromptVersion,
  onViewArtVersion,
  onSubmitVersion
}) => {
  const droppedIds = latestGeneration?.droppedBlockIds ?? []
  const droppedLabels =
    spec && droppedIds.length > 0 ? droppedIds.slice(0, 6).map((id) => blockLabelById(id, spec)) : []

  return (
    <div className="wb3-prompt-wrap" data-testid="wb3-prompt-view">
      {droppedLabels.length > 0 ? (
        <div className="wb3-banner" role="alert" data-testid="wb3-dropped-banner">
          <span className="wb3-banner-dot" aria-hidden="true" />
          <span>
            {droppedIds.length} 个块没有落到第 {promptVersion?.versionNumber ?? '—'} 版：
            {droppedLabels.join('、')}
            {droppedIds.length > droppedLabels.length ? ' 等' : ''}
          </span>
          <Button variant="quiet" size="sm" onClick={onRegenerate}>
            重新生成
          </Button>
        </div>
      ) : null}
      <div className="wb3-prompt-layout">
        <PromptEditorCard
          characterTitle={characterTitle}
          characterSummary={characterSummary}
          spec={spec}
          referenceCount={referenceCount}
          readOnly={readOnly}
          dirty={dirty}
          canCommit={canCommit}
          busy={busy}
          filter={filter}
          droppedBlockIds={latestGeneration?.droppedBlockIds ?? []}
          promptVersionError={promptVersionError}
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
    </div>
  )
}
