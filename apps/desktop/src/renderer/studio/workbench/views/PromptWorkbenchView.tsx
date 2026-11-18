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
  characterTitle,
  characterSummary,
  promptVersion,
  referenceCount,
  spec,
  readOnly,
  dirty,
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
      <aside className="wb3-card wb3-overview-card" data-testid="wb3-version-overview">
        {promptVersion ? (
          <>
            <header className="wb3-overview-heading">
              <h2>当前版本 第 {promptVersion.versionNumber} 版</h2>
              <span>
                {spec ? spec.blocks.length + spec.negativeBlocks.length : 0} 块 · {referenceCount} 张参考图
              </span>
            </header>
            <p className="wb3-overview-muted">在后续 Task 中补齐参考图、立绘和版本历史。</p>
          </>
        ) : (
          <p className="wb3-overview-muted">还没有提示词版本。</p>
        )}
      </aside>
    </div>
  )
}
