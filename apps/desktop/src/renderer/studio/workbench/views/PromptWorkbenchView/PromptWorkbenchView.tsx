import React from 'react'
import type { ArtProjectDto, ArtVersionDto, GenerationDto, PromptVersionDto } from '@studio/api'
import type { PromptSpecV2 } from '@studio/api'
import { Button } from '@agent2live/design-system'
import type { PromptFilter } from '../../prompt-diagnostics'
import { blockLabelById } from '../../prompt-diagnostics'
import { PromptEditorCard } from '../../components/prompt/PromptEditorCard'
import { VersionOverviewCard } from '../../components/prompt/VersionOverviewCard'
import styles from './PromptWorkbenchView.module.scss'

export interface PromptWorkbenchViewProps {
  project: ArtProjectDto
  characterTitle: string
  characterSummary: string | null
  promptVersion: PromptVersionDto | null
  artVersions: ArtVersionDto[]
  spec: PromptSpecV2 | null
  referenceCount: number
  readOnly: boolean
  busy: boolean
  filter: PromptFilter
  latestGeneration: GenerationDto | null
  promptVersionError: string | null
  error: string | null
  onFilterChange(filter: PromptFilter): void
  onRename(): void
  onOpenBlock(blockId: string, negative: boolean): void
  onNewBlock(negative: boolean): void
  onOpenAiRewrite(): void
  onOpenReverse(): void
  onOpenFullPrompt(): void
  onOpenReferences(): void
  onRegenerate(): void
  onViewArtVersion(versionId: string): void
}

export const PromptWorkbenchView: React.FC<PromptWorkbenchViewProps> = ({
  project,
  characterTitle,
  characterSummary,
  promptVersion,
  artVersions,
  spec,
  referenceCount,
  readOnly,
  busy,
  filter,
  latestGeneration,
  promptVersionError,
  error,
  onFilterChange,
  onRename,
  onOpenBlock,
  onNewBlock,
  onOpenAiRewrite,
  onOpenReverse,
  onOpenFullPrompt,
  onOpenReferences,
  onRegenerate,
  onViewArtVersion
}) => {
  const droppedIds = latestGeneration?.droppedBlockIds ?? []
  const droppedLabels =
    spec && droppedIds.length > 0 ? droppedIds.slice(0, 6).map((id) => blockLabelById(id, spec)) : []

  return (
    <div className={styles['wb3-prompt-wrap']!} data-testid="wb3-prompt-view">
      {droppedLabels.length > 0 ? (
        <div className={styles['wb3-banner']!} role="alert" data-testid="wb3-dropped-banner">
          <span className={styles['wb3-banner-dot']!} aria-hidden="true" />
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
      <div className={styles['wb3-prompt-layout']!}>
        <PromptEditorCard
          characterTitle={characterTitle}
          characterSummary={characterSummary}
          spec={spec}
          referenceCount={referenceCount}
          readOnly={readOnly}
          busy={busy}
          filter={filter}
          droppedBlockIds={latestGeneration?.droppedBlockIds ?? []}
          promptVersionError={promptVersionError}
          error={error}
          onFilterChange={onFilterChange}
          onRename={onRename}
          onOpenBlock={onOpenBlock}
          onNewBlock={onNewBlock}
          onOpenAiRewrite={onOpenAiRewrite}
          onOpenReverse={onOpenReverse}
          onOpenFullPrompt={onOpenFullPrompt}
          onOpenReferences={onOpenReferences}
        />
        <VersionOverviewCard
          project={project}
          promptVersion={promptVersion}
          artVersions={artVersions}
          onViewArtVersion={onViewArtVersion}
        />
      </div>
    </div>
  )
}
