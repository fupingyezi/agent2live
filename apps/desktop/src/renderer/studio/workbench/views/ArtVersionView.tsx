import React from 'react'
import type { ArtProjectDto, ArtVersionDto, GenerationDto, PromptVersionDto } from '@studio/api'
import { Button, EmptyState, InlineNotice } from '@agent2live/design-system'
import { ArtVersionList } from '../components/versions/ArtVersionList'
import { ArtVersionViewer } from '../components/versions/ArtVersionViewer'
import { ArtVersionInspector } from '../components/versions/ArtVersionInspector'
import { WorkbenchActionBar } from '../components/WorkbenchActionBar'

export interface ArtVersionViewProps {
  project: ArtProjectDto
  artVersions: ArtVersionDto[]
  selectedVersion: ArtVersionDto | null
  promptVersion: PromptVersionDto | null
  generations: GenerationDto[]
  activating: boolean
  error: string | null
  onSelect(versionId: string): void
  onActivate(): void
  onFork(): void
  onOpenVersions(): void
  onBackToPrompt(): void
  onOpenLayered(): void
}

export const ArtVersionView: React.FC<ArtVersionViewProps> = ({
  project,
  artVersions,
  selectedVersion,
  promptVersion,
  generations,
  activating,
  error,
  onSelect,
  onActivate,
  onFork,
  onOpenVersions,
  onBackToPrompt,
  onOpenLayered
}) => {
  if (artVersions.length === 0 || !selectedVersion) {
    return (
      <div className="wb3-version-empty" data-testid="wb3-art-version-view">
        <EmptyState
          title="还没有立绘版本"
          description="在提示词工作台生成一组候选，保存其中一张后会出现在这里。"
          action={
            <Button variant="primary" onClick={onBackToPrompt}>
              去提示词工作台
            </Button>
          }
        />
      </div>
    )
  }

  const active = selectedVersion.id === project.activeVersionId
  const parentVersion = artVersions.find((version) => version.id === selectedVersion.parentVersionId) ?? null

  return (
    <div className="wb3-version-view" data-testid="wb3-art-version-view">
      <div className="wb3-version-layout">
        <ArtVersionList
          versions={artVersions}
          activeVersionId={project.activeVersionId}
          selectedVersionId={selectedVersion.id}
          onSelect={onSelect}
        />
        <ArtVersionViewer
          version={selectedVersion}
          versions={artVersions}
          generations={generations}
          onSelect={onSelect}
        />
        <ArtVersionInspector
          project={project}
          version={selectedVersion}
          promptVersion={promptVersion}
          parentVersionNumber={parentVersion?.versionNumber ?? null}
          activating={activating}
          onActivate={onActivate}
          onFork={onFork}
          onOpenVersions={onOpenVersions}
          onBackToPrompt={onBackToPrompt}
        />
      </div>
      {error ? (
        <div className="wb3-version-error" role="alert">
          <InlineNotice tone="danger">{error}</InlineNotice>
        </div>
      ) : null}
      <WorkbenchActionBar
        status={
          active
            ? `第 ${selectedVersion.versionNumber} 版 在用 · 以它作为下次生成的主参考`
            : `第 ${selectedVersion.versionNumber} 版 历史版本 · 设为当前参考后可继续分层`
        }
        busy={activating}
      >
        {!active ? (
          <Button variant="secondary" disabled={activating} onClick={onActivate}>
            {activating ? '切换中…' : '设为当前参考'}
          </Button>
        ) : null}
        <Button variant="primary" disabled={!active || activating} onClick={onOpenLayered}>
          打开分层
        </Button>
      </WorkbenchActionBar>
    </div>
  )
}
