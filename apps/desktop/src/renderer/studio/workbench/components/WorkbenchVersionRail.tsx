import React from 'react'
import type { ArtProjectDto, ArtVersionDto, PromptDraftDto, PromptVersionSummaryDto } from '@studio/api'
import { useAssetUrl } from '@studio/hooks'
import { Button } from '@agent2live/design-system'

interface ArtVersionNodeProps {
  project: ArtProjectDto
  version: ArtVersionDto
  promptVersion: PromptVersionSummaryDto | null
  selected: boolean
  onSelect: () => void
}

const ArtVersionNode: React.FC<ArtVersionNodeProps> = ({
  project,
  version,
  promptVersion,
  selected,
  onSelect
}) => {
  const assetId =
    version.references.find((reference) => reference.isPrimary)?.assetId ??
    version.references[0]?.assetId ??
    null
  const { url } = useAssetUrl(assetId)
  const active = version.id === project.activeVersionId

  return (
    <button
      type="button"
      className="workbench-version-node"
      data-testid="workbench-version-node"
      data-version-id={version.id}
      data-active={active}
      data-selected={selected}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="workbench-version-node-thumb">
        {url ? <img src={url} alt={`美术版本 v${version.versionNumber}`} /> : <span aria-hidden="true" />}
      </span>
      <span className="workbench-version-node-copy">
        <strong>美术 v{version.versionNumber}</strong>
        <small>
          {promptVersion ? `提示词 v${promptVersion.versionNumber}` : '提示词版本'}
          {active ? ' · 当前' : ' · 历史'}
        </small>
      </span>
    </button>
  )
}

export interface WorkbenchVersionRailProps {
  project: ArtProjectDto
  characterTitle: string
  draft: PromptDraftDto | null
  artVersions: ArtVersionDto[]
  promptVersions: PromptVersionSummaryDto[]
  selectedArtVersionId: string | null
  selectedDraft: boolean
  busy: boolean
  onSelectDraft: () => void
  onSelectVersion: (version: ArtVersionDto) => void
  onOpenMaterials: () => void
  onOpenVersions: () => void
}

export const WorkbenchVersionRail: React.FC<WorkbenchVersionRailProps> = ({
  project,
  characterTitle,
  draft,
  artVersions,
  promptVersions,
  selectedArtVersionId,
  selectedDraft,
  busy,
  onSelectDraft,
  onSelectVersion,
  onOpenMaterials,
  onOpenVersions
}) => {
  const promptById = new Map(promptVersions.map((version) => [version.id, version]))
  const draftPrompt = draft?.baseVersionId ? promptById.get(draft.baseVersionId) : null

  return (
    <aside className="workbench-design-version-tree" data-testid="workbench-version-rail">
      <h1 className="workbench-design-project-title">{project.title}</h1>
      <div className="workbench-design-identity">
        <strong>{characterTitle}</strong>
        <span>提示词与立绘联动</span>
      </div>
      <div className="workbench-design-version-heading">
        <span>工作区</span>
        <span>{artVersions.length} 个美术版本</span>
      </div>
      <div className="workbench-design-version-list">
        {draft ? (
          <button
            type="button"
            className="workbench-version-node workbench-version-draft"
            data-testid="workbench-draft-node"
            data-selected={selectedDraft}
            aria-pressed={selectedDraft}
            disabled={busy}
            onClick={onSelectDraft}
          >
            <span className="workbench-version-node-thumb" aria-hidden="true">
              稿
            </span>
            <span className="workbench-version-node-copy">
              <strong>当前草稿</strong>
              <small>
                {draftPrompt ? `基于提示词 v${draftPrompt.versionNumber}` : '可继续编辑'} · revision{' '}
                {draft.revision}
              </small>
            </span>
          </button>
        ) : null}

        {artVersions.map((version) => (
          <ArtVersionNode
            key={version.id}
            project={project}
            version={version}
            promptVersion={promptById.get(version.promptVersionId) ?? null}
            selected={selectedArtVersionId === version.id}
            onSelect={() => onSelectVersion(version)}
          />
        ))}
      </div>
      <div className="workbench-version-rail-actions">
        <Button type="button" variant="quiet" size="sm" onClick={onOpenMaterials}>
          素材与要求
        </Button>
        <Button type="button" variant="quiet" size="sm" onClick={onOpenVersions}>
          版本操作
        </Button>
      </div>
    </aside>
  )
}
