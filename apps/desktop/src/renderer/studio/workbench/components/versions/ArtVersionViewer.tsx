import React, { useState } from 'react'
import type { ArtVersionDto, GenerationDto } from '@studio/api'
import { useAssetUrl } from '@studio/hooks'
import { formatDateTime } from '@studio/format'
import { Button, Dialog, EmptyState } from '@agent2live/design-system'

function dimensions(version: ArtVersionDto): string | null {
  const validation = version.validation as {
    candidateValidation?: { width?: unknown; height?: unknown }
  }
  const width = validation.candidateValidation?.width
  const height = validation.candidateValidation?.height
  return typeof width === 'number' && typeof height === 'number' ? `${width} × ${height}` : null
}

function candidateOrdinal(version: ArtVersionDto, generations: GenerationDto[]): number | null {
  if (version.sourceKind !== 'generated') return null
  const source = version.source as { candidateId?: unknown; generationJobId?: unknown }
  if (typeof source.candidateId !== 'string') return null
  const generation = generations.find(
    (entry) =>
      entry.id === source.generationJobId ||
      entry.candidates.some((candidate) => candidate.id === source.candidateId)
  )
  if (!generation) return null
  const index = generation.candidates.findIndex((candidate) => candidate.id === source.candidateId)
  return index >= 0 ? index + 1 : null
}

function sourceText(version: ArtVersionDto, generations: GenerationDto[]): string {
  if (version.sourceKind === 'manual_upload') {
    return `手工上传于 ${formatDateTime(version.createdAt)}`
  }
  if (version.sourceKind === 'fork_seed') {
    return `从分支产生的第 ${version.versionNumber} 版`
  }
  const ordinal = candidateOrdinal(version, generations)
  return `生成于 ${formatDateTime(version.createdAt)}${ordinal === null ? '' : ` · 第 ${ordinal} 张候选`}`
}

export interface ArtVersionViewerProps {
  version: ArtVersionDto | null
  versions: ArtVersionDto[]
  generations: GenerationDto[]
  onSelect(versionId: string): void
}

export const ArtVersionViewer: React.FC<ArtVersionViewerProps> = ({
  version,
  versions,
  generations,
  onSelect
}) => {
  const [lightbox, setLightbox] = useState(false)
  const { url, isLoading, error } = useAssetUrl(version?.artworkAssetId ?? null)

  if (!version) {
    return (
      <div className="wb3-version-viewer" data-testid="wb3-art-version-viewer">
        <EmptyState
          title="还没有立绘版本"
          description="在提示词工作台生成一组候选，并保存其中一张。"
        />
      </div>
    )
  }

  const ordered = [...versions].sort((left, right) => right.versionNumber - left.versionNumber)
  const index = ordered.findIndex((entry) => entry.id === version.id)
  const newer = index > 0 ? ordered[index - 1] : null
  const older = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null
  const size = dimensions(version)

  return (
    <section className="wb3-version-viewer" data-testid="wb3-art-version-viewer">
      <header className="wb3-viewer-head">
        <div>
          <strong>第 {version.versionNumber} 版</strong>
          {size ? <span>{size}</span> : null}
        </div>
        <div className="wb3-viewer-actions">
          <Button
            variant="secondary"
            size="sm"
            disabled={!newer}
            onClick={() => newer && onSelect(newer.id)}
          >
            上一张
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!older}
            onClick={() => older && onSelect(older.id)}
          >
            下一张
          </Button>
        </div>
      </header>
      <div className="wb3-viewer-image">
        {isLoading ? <span>加载中…</span> : error || !url ? <span>无法加载原图</span> : <img src={url} alt={`第 ${version.versionNumber} 版立绘`} />}
      </div>
      <footer className="wb3-viewer-foot">
        <span>{sourceText(version, generations)}</span>
        <Button variant="quiet" size="sm" disabled={!url} onClick={() => setLightbox(true)}>
          看原图
        </Button>
      </footer>
      <Dialog
        open={lightbox}
        onOpenChange={setLightbox}
        title={`第 ${version.versionNumber} 版原图`}
        className="wb3-lightbox"
      >
        {url ? <img className="wb3-lightbox-image" src={url} alt={`第 ${version.versionNumber} 版原图`} /> : null}
      </Dialog>
    </section>
  )
}
