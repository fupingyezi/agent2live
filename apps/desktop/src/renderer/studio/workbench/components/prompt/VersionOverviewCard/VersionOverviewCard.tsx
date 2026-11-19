import React, { useState } from 'react'
import type { ArtProjectDto, ArtVersionDto, PromptVersionDto, PromptVersionSummaryDto } from '@studio/api'
import { useAssetUrl } from '@studio/hooks'
import { formatDateTime } from '@studio/format'
import { Button, StatusPill } from '@agent2live/design-system'
import { ART_SOURCE_LABELS, MATERIAL_ROLE_LABELS } from '../../../prompt-labels'
import styles from './VersionOverviewCard.module.scss'

interface ReferenceThumbProps {
  assetId: string
  label: string
}

const ReferenceThumb: React.FC<ReferenceThumbProps> = ({ assetId, label }) => {
  const { url, isLoading, error } = useAssetUrl(assetId)
  return (
    <figure className={styles['wb3-reference-item']!} data-testid="wb3-reference-thumb">
      <div className={styles['wb3-reference-image']!}>
        {url ? (
          <img src={url} alt={`${label}参考图`} />
        ) : (
          <span>{isLoading ? '…' : error ? '无法加载' : '—'}</span>
        )}
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  )
}

interface ArtVersionRowProps {
  version: ArtVersionDto
  active: boolean
  onView(): void
}

const ArtVersionRow: React.FC<ArtVersionRowProps> = ({ version, active, onView }) => {
  const { url } = useAssetUrl(version.artworkAssetId)
  return (
    <div className={styles['wb3-art-row']!} data-testid="wb3-art-version-row" data-version-id={version.id}>
      <span className={styles['wb3-art-thumb']!}>
        {url ? <img src={url} alt={`立绘 v${version.versionNumber}`} /> : <span aria-hidden="true" />}
      </span>
      <span className={styles['wb3-art-copy']!}>
        <strong>第 {version.versionNumber} 版</strong>
        <small>
          {ART_SOURCE_LABELS[version.sourceKind]} · {formatDateTime(version.createdAt)}
        </small>
      </span>
      {active ? <StatusPill label="在用" tone="success" /> : null}
      <Button variant="quiet" size="sm" onClick={onView}>
        查看
      </Button>
    </div>
  )
}

export interface VersionOverviewCardProps {
  project: ArtProjectDto
  promptVersion: PromptVersionDto | null
  promptVersions: PromptVersionSummaryDto[]
  artVersions: ArtVersionDto[]
  onOpenReferences(): void
  onOpenVersions(): void
  onSelectPromptVersion(versionId: string): void
  onRollback(versionId: string): void
  onViewArtVersion(versionId: string): void
}

export const VersionOverviewCard: React.FC<VersionOverviewCardProps> = ({
  project,
  promptVersion,
  promptVersions,
  artVersions,
  onOpenReferences,
  onOpenVersions,
  onSelectPromptVersion,
  onRollback,
  onViewArtVersion
}) => {
  const [showAllHistory, setShowAllHistory] = useState(false)
  const [showAllArt, setShowAllArt] = useState(false)

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

  const blockCount = promptVersion.state.blocks.length + promptVersion.state.negativeBlocks.length
  const references = promptVersion.state.materialRefs
  const linkedArt = artVersions
    .filter((version) => version.promptVersionId === promptVersion.id)
    .sort((left, right) => right.versionNumber - left.versionNumber)
  const parent = promptVersions.find((version) => version.id === promptVersion.parentVersionId)
  const history = [...promptVersions].sort((left, right) => right.versionNumber - left.versionNumber)
  const visibleHistory = showAllHistory ? history : history.slice(0, 3)
  const archivedCount = Math.max(0, history.length - 3)
  const visibleArt = showAllArt ? linkedArt : linkedArt.slice(0, 4)

  return (
    <aside
      className={`${styles['wb3-card']!} ${styles['wb3-overview-card']!}`}
      data-testid="wb3-version-overview"
    >
      <header className={styles['wb3-overview-heading']!}>
        <div className={styles['wb3-overview-title']!}>
          <h2>
            {project.activePromptVersionId === promptVersion.id ? '当前版本' : '历史版本'} 第{' '}
            {promptVersion.versionNumber} 版
          </h2>
          <span>
            {blockCount} 块 · {references.length} 张参考图
          </span>
        </div>
        <div className={styles['wb3-overview-meta']!}>
          <span>来自 {parent ? `第 ${parent.versionNumber} 版` : '新建角色'}</span>
          <span>提交 {formatDateTime(promptVersion.createdAt)}</span>
        </div>
      </header>

      <section className={styles['wb3-overview-section']!}>
        <div className={styles['wb3-overview-section-head']!}>
          <h3>参考图 {references.length} / 14</h3>
          <Button variant="quiet" size="sm" onClick={onOpenReferences}>
            查看全部
          </Button>
        </div>
        {references.length === 0 ? (
          <p className={styles['wb3-overview-muted']!}>还没有参考图，按文生图生成。</p>
        ) : (
          <div className={styles['wb3-reference-grid']!}>
            {references.slice(0, 6).map((reference) => (
              <ReferenceThumb
                key={reference.assetId}
                assetId={reference.assetId}
                label={MATERIAL_ROLE_LABELS[reference.role]}
              />
            ))}
          </div>
        )}
      </section>

      <section className={styles['wb3-overview-section']!}>
        <div className={styles['wb3-overview-section-head']!}>
          <h3>当前版本生成的立绘 {linkedArt.length} 个</h3>
          <Button variant="quiet" size="sm" onClick={onOpenVersions}>
            查看全部
          </Button>
        </div>
        {linkedArt.length === 0 ? (
          <p className={styles['wb3-overview-muted']!}>还没有由这一版提示词生成的立绘。</p>
        ) : (
          <div className={styles['wb3-art-list']!}>
            {visibleArt.map((version) => (
              <ArtVersionRow
                key={version.id}
                version={version}
                active={version.id === project.activeVersionId}
                onView={() => onViewArtVersion(version.id)}
              />
            ))}
            {!showAllArt && linkedArt.length > 4 ? (
              <Button variant="quiet" size="sm" onClick={() => setShowAllArt(true)}>
                查看全部 {linkedArt.length} 个
              </Button>
            ) : null}
          </div>
        )}
      </section>

      <section className={styles['wb3-overview-section']!}>
        <div className={styles['wb3-overview-section-head']!}>
          <h3>版本历史</h3>
          <Button variant="quiet" size="sm" onClick={onOpenVersions}>
            管理全部
          </Button>
        </div>
        <div className={styles['wb3-history-list']!}>
          {visibleHistory.map((version) => {
            const current = version.id === project.activePromptVersionId
            return (
              <div
                key={version.id}
                className={styles['wb3-history-row']!}
                data-testid="wb3-prompt-history-row"
                data-version-id={version.id}
              >
                <button
                  type="button"
                  className={styles['wb3-history-main']!}
                  onClick={() => onSelectPromptVersion(version.id)}
                >
                  <strong>第 {version.versionNumber} 版</strong>
                  <span>{formatDateTime(version.createdAt)}</span>
                </button>
                {current ? (
                  <StatusPill label="当前" tone="success" />
                ) : (
                  <Button variant="quiet" size="sm" onClick={() => onRollback(version.id)}>
                    回到这版
                  </Button>
                )}
              </div>
            )
          })}
        </div>
        {!showAllHistory && archivedCount > 0 ? (
          <Button variant="quiet" size="sm" onClick={() => setShowAllHistory(true)}>
            更早 {archivedCount} 个版本 已归档 · 查看全部
          </Button>
        ) : null}
      </section>
    </aside>
  )
}
