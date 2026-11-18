import React from 'react'
import type { ArtVersionDto } from '@studio/api'
import { useAssetUrl } from '@studio/hooks'
import { formatDateTime } from '@studio/format'
import { StatusPill } from '@agent2live/design-system'
import { ART_SOURCE_LABELS } from '../../prompt-labels'

interface ArtVersionItemProps {
  version: ArtVersionDto
  active: boolean
  selected: boolean
  onSelect(): void
}

const ArtVersionItem: React.FC<ArtVersionItemProps> = ({ version, active, selected, onSelect }) => {
  const { url } = useAssetUrl(version.artworkAssetId)
  return (
    <button
      type="button"
      className="wb3-version-item"
      data-testid="wb3-art-version-item"
      data-version-id={version.id}
      data-state={selected ? 'selected' : 'default'}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="wb3-version-thumb">
        {url ? <img src={url} alt={`第 ${version.versionNumber} 版`} /> : <span aria-hidden="true" />}
      </span>
      <span className="wb3-version-copy">
        <strong>
          第 {version.versionNumber} 版{active ? ' · 在用' : ''}
        </strong>
        <small>
          {ART_SOURCE_LABELS[version.sourceKind]} · {formatDateTime(version.createdAt)}
        </small>
      </span>
      {active ? <StatusPill label="在用" tone="success" /> : null}
    </button>
  )
}

export interface ArtVersionListProps {
  versions: ArtVersionDto[]
  activeVersionId: string | null
  selectedVersionId: string | null
  onSelect(versionId: string): void
}

export const ArtVersionList: React.FC<ArtVersionListProps> = ({
  versions,
  activeVersionId,
  selectedVersionId,
  onSelect
}) => {
  const ordered = [...versions].sort((left, right) => right.versionNumber - left.versionNumber)
  return (
    <aside className="wb3-version-list" data-testid="wb3-art-version-list">
      <header className="wb3-version-list-head">
        <h2>版本 {ordered.length} 个</h2>
        <span>按时间倒序</span>
      </header>
      <div className="wb3-version-list-scroll">
        {ordered.map((version) => (
          <ArtVersionItem
            key={version.id}
            version={version}
            active={version.id === activeVersionId}
            selected={version.id === selectedVersionId}
            onSelect={() => onSelect(version.id)}
          />
        ))}
      </div>
      <footer className="wb3-version-list-foot">切换当前参考不会覆盖任何旧版本。</footer>
    </aside>
  )
}
