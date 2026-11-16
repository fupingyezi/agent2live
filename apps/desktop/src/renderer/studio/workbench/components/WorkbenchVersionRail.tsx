import React from 'react'
import type { ArtProjectDto, ArtVersionDto, PromptVersionSummaryDto } from '@studio/api'
import { useAssetUrl } from '@studio/hooks'
import { Button } from '@agent2live/design-system'

interface ArtVersionNodeProps {
  project: ArtProjectDto
  version: ArtVersionDto
  promptVersion: PromptVersionSummaryDto | null
  selected: boolean
  onSelect: () => void
}

interface PromptVersionNodeProps {
  project: ArtProjectDto
  version: PromptVersionSummaryDto
  linkedArtVersions: ArtVersionDto[]
  selected: boolean
  onSelect: () => void
}

const PromptVersionNode: React.FC<PromptVersionNodeProps> = ({
  project,
  version,
  linkedArtVersions,
  selected,
  onSelect
}) => {
  const active = version.id === project.activePromptVersionId
  return (
    <button
      type="button"
      className="workbench-version-node workbench-prompt-version-node"
      data-testid="workbench-prompt-version-node"
      data-version-id={version.id}
      data-active={active}
      data-selected={selected}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="workbench-version-node-thumb" aria-hidden="true">
        v{version.versionNumber}
      </span>
      <span className="workbench-version-node-copy">
        <strong>提示词 v{version.versionNumber}</strong>
        <small>
          {linkedArtVersions.length > 0
            ? `美术 ${linkedArtVersions.map((artVersion) => `v${artVersion.versionNumber}`).join('、')}`
            : '尚未生成立绘'}
          {active ? ' · 当前' : ' · 历史'}
        </small>
      </span>
    </button>
  )
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
  artVersions: ArtVersionDto[]
  promptVersions: PromptVersionSummaryDto[]
  selectedPromptVersionId: string | null
  selectedArtVersionId: string | null
  busy: boolean
  onSelectPromptVersion: (version: PromptVersionSummaryDto) => void
  onSelectVersion: (version: ArtVersionDto) => void
  onOpenMaterials: () => void
  onOpenVersions: () => void
}

export const WorkbenchVersionRail: React.FC<WorkbenchVersionRailProps> = ({
  project,
  characterTitle,
  artVersions,
  promptVersions,
  selectedPromptVersionId,
  selectedArtVersionId,
  busy,
  onSelectPromptVersion,
  onSelectVersion,
  onOpenMaterials,
  onOpenVersions
}) => {
  const promptById = new Map(promptVersions.map((version) => [version.id, version]))

  return (
    <aside className="workbench-design-version-tree" data-testid="workbench-version-rail">
      <h1 className="workbench-design-project-title">{project.title}</h1>
      <div className="workbench-design-identity">
        <strong>{characterTitle}</strong>
        <span>提示词与立绘联动</span>
      </div>
      <div className="workbench-design-version-heading">
        <span>提示词</span>
        <span>{promptVersions.length} 个版本</span>
      </div>
      <div className="workbench-design-version-list">
        {promptVersions.map((version) => (
          <PromptVersionNode
            key={version.id}
            project={project}
            version={version}
            linkedArtVersions={artVersions.filter((artVersion) => artVersion.promptVersionId === version.id)}
            selected={selectedPromptVersionId === version.id}
            onSelect={() => onSelectPromptVersion(version)}
          />
        ))}
      </div>

      <div className="workbench-design-version-heading">
        <span>美术</span>
        <span>{artVersions.length} 个版本</span>
      </div>
      <div className="workbench-design-version-list">
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
