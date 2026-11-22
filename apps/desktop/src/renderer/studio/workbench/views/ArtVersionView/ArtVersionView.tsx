import React, { useState } from 'react'
import type { ArtProjectDto, ArtVersionDto, PromptVersionDto } from '@studio/api'
import { useAssetUrl } from '@studio/hooks'
import { formatDateTime, formatStage } from '@studio/format'
import { Button, Dialog, EmptyState, InlineNotice, KeyValueList } from '@agent2live/design-system'
import { WorkbenchActionBar } from '../../components/WorkbenchActionBar'
import { ART_SOURCE_LABELS } from '../../prompt-labels'
import styles from './ArtVersionView.module.scss'

export interface ArtVersionViewProps {
  project: ArtProjectDto
  currentVersion: ArtVersionDto | null
  promptVersion: PromptVersionDto | null
  error: string | null
  onBackToPrompt(): void
  onRegenerate(): void
  onOpenLayered(): void
}

export const ArtVersionView: React.FC<ArtVersionViewProps> = ({
  project,
  currentVersion,
  promptVersion,
  error,
  onBackToPrompt,
  onRegenerate,
  onOpenLayered
}) => {
  const [lightbox, setLightbox] = useState(false)
  const { url, isLoading, error: imageError } = useAssetUrl(currentVersion?.artworkAssetId ?? null)

  if (!currentVersion) {
    return (
      <div className={styles['wb3-version-empty']!} data-testid="wb3-art-version-view">
        <EmptyState
          title="还没有当前立绘"
          description="在提示词工作台生成一组候选，选中其中一张后会成为唯一当前立绘。"
          action={
            <Button variant="primary" onClick={onBackToPrompt}>
              去提示词工作台
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className={styles['wb3-version-view']!} data-testid="wb3-art-version-view">
      <div className={styles['wb3-current-artwork']!}>
        <section className={styles['wb3-current-canvas']!}>
          {isLoading ? (
            <span>加载中…</span>
          ) : imageError || !url ? (
            <span>无法加载当前立绘</span>
          ) : (
            <button type="button" className={styles['wb3-current-image']!} onClick={() => setLightbox(true)}>
              <img src={url} alt="当前立绘" />
            </button>
          )}
        </section>
        <aside className={styles['wb3-current-info']!} data-testid="wb3-art-version-inspector">
          <header>
            <h2>当前立绘</h2>
          </header>
          <KeyValueList
            items={[
              { label: '来源', value: ART_SOURCE_LABELS[currentVersion.sourceKind] },
              { label: '生成时间', value: formatDateTime(currentVersion.createdAt) },
              { label: '项目阶段', value: formatStage(project.stage) },
              {
                label: '依据提示词',
                value: promptVersion ? `第 ${promptVersion.versionNumber} 版` : '加载中…'
              }
            ]}
          />
          <div className={styles['wb3-current-note']!}>
            <strong>修改从这里开始</strong>
            <p>不满意时继续修改提示词并生成新候选。新候选会和这张图对比，最多选一张替换。</p>
          </div>
          {error ? (
            <div role="alert">
              <InlineNotice tone="danger">{error}</InlineNotice>
            </div>
          ) : null}
          <Button variant="secondary" onClick={onBackToPrompt}>
            继续修改提示词
          </Button>
        </aside>
      </div>
      <WorkbenchActionBar status="当前只维护这一张立绘">
        <Button variant="secondary" onClick={onRegenerate}>
          重新生成
        </Button>
        <Button variant="primary" onClick={onOpenLayered}>
          打开分层
        </Button>
      </WorkbenchActionBar>
      <Dialog open={lightbox} onOpenChange={setLightbox} title="当前立绘原图">
        {url ? <img className={styles['wb3-current-lightbox']!} src={url} alt="当前立绘原图" /> : null}
      </Dialog>
    </div>
  )
}
