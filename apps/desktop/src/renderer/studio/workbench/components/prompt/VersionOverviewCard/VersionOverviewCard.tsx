import React from 'react'
import type { ArtProjectDto, ArtVersionDto, PromptVersionDto } from '@studio/api'
import { useAssetUrl } from '@studio/hooks'
import { formatDateTime } from '@studio/format'
import { Button } from '@agent2live/design-system'
import { ART_SOURCE_LABELS } from '../../../prompt-labels'
import styles from './VersionOverviewCard.module.scss'

interface ArtImageProps {
  assetId: string
  alt: string
}

const ArtImage: React.FC<ArtImageProps> = ({ assetId, alt }) => {
  const { url, isLoading, error } = useAssetUrl(assetId)
  return url ? (
    <img src={url} alt={alt} />
  ) : (
    <span className={styles['art-placeholder']!}>{isLoading ? '…' : error ? '无法加载' : '—'}</span>
  )
}

export interface VersionOverviewCardProps {
  project: ArtProjectDto
  promptVersion: PromptVersionDto | null
  artVersions: ArtVersionDto[]
  onViewArtVersion(versionId: string): void
}

export const VersionOverviewCard: React.FC<VersionOverviewCardProps> = ({
  project,
  promptVersion,
  artVersions,
  onViewArtVersion
}) => {
  if (!promptVersion) {
    return (
      <aside
        className={`${styles['wb3-card']!} ${styles['wb3-overview-card']!}`}
        data-testid="wb3-version-overview"
      >
        <p className={styles['wb3-overview-muted']!}>还没有提示词版本。</p>
      </aside>
    )
  }

  const currentArt = artVersions.find((version) => version.id === project.activeVersionId) ?? null

  return (
    <aside
      className={`${styles['wb3-card']!} ${styles['wb3-overview-card']!}`}
      data-testid="wb3-version-overview"
    >
      <header className={styles['wb3-overview-heading']!}>
        <h2>
          {`${project.activePromptVersionId === promptVersion.id ? '当前提示词' : '历史提示词'} 第 ${
            promptVersion.versionNumber
          } 版`}
        </h2>
      </header>

      {currentArt ? (
        <>
          <div className={styles['wb3-art-preview']!}>
            <ArtImage assetId={currentArt.artworkAssetId} alt="当前立绘" />
          </div>

          <div className={styles['wb3-art-facts']!}>
            <div>
              <span>来源</span>
              <strong>{ART_SOURCE_LABELS[currentArt.sourceKind]}</strong>
            </div>
            <div>
              <span>时间</span>
              <strong>{formatDateTime(currentArt.createdAt)}</strong>
            </div>
          </div>

          <div className={styles['wb3-art-footer']!}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onViewArtVersion(currentArt.id)}
            >
              打开当前立绘
            </Button>
          </div>
        </>
      ) : (
        <p className={styles['wb3-overview-muted']!}>还没有当前立绘。修改提示词后生成第一张。</p>
      )}
    </aside>
  )
}
