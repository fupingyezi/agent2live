import React, { useEffect, useRef, useState } from 'react'
import type { ArtProjectDto, ArtVersionDto, PromptVersionDto } from '@studio/api'
import { useAssetUrl } from '@studio/hooks'
import { formatDateTime, formatStage } from '@studio/format'
import { Button, Dialog, EmptyState, InlineNotice, KeyValueList } from '@agent2live/design-system'
import { WorkbenchActionBar } from '../../components/WorkbenchActionBar'
import { ART_SOURCE_LABELS } from '../../prompt-labels'
import styles from './ArtVersionView.module.scss'

function assetExtension(mediaType: string | null): 'png' | 'jpg' | 'webp' {
  if (mediaType === 'image/jpeg') return 'jpg'
  if (mediaType === 'image/webp') return 'webp'
  return 'png'
}

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
  const [zoom, setZoom] = useState(1)
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null)
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number } | null>(null)
  const lightboxViewportRef = useRef<HTMLDivElement>(null)
  const { url, mediaType, isLoading, error: imageError } = useAssetUrl(currentVersion?.artworkAssetId ?? null)
  const setClampedZoom = (next: number): void => setZoom(Math.min(4, Math.max(1, next)))

  useEffect(() => {
    setNaturalSize(null)
  }, [url])

  useEffect(() => {
    if (!lightbox) return
    const measure = (): void => {
      const viewport = lightboxViewportRef.current
      if (!viewport) return
      setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight })
    }
    const frame = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
    }
  }, [lightbox])

  useEffect(() => {
    if (!lightbox) return
    const viewport = lightboxViewportRef.current
    if (!viewport) return
    const frame = requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2)
      viewport.scrollTop = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2)
    })
    return () => cancelAnimationFrame(frame)
  }, [lightbox, zoom, viewportSize, naturalSize])

  const fitScale =
    naturalSize && viewportSize
      ? Math.min(
          1,
          (viewportSize.width - 8) / naturalSize.width,
          (viewportSize.height - 8) / naturalSize.height
        )
      : null
  const renderedSize =
    naturalSize && fitScale
      ? {
          width: naturalSize.width * fitScale * zoom,
          height: naturalSize.height * fitScale * zoom
        }
      : null
  const canvasSize =
    renderedSize && viewportSize
      ? {
          width: Math.max(viewportSize.width, renderedSize.width),
          height: Math.max(viewportSize.height, renderedSize.height)
        }
      : undefined

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
            <button
              type="button"
              className={styles['wb3-current-image']!}
              data-testid="wb3-current-image"
              onClick={() => {
                setZoom(1)
                setLightbox(true)
              }}
            >
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
      <WorkbenchActionBar status="当前立绘">
        {url ? (
          <Button asChild variant="secondary">
            <a
              data-testid="wb3-download-artwork"
              href={url}
              download={`artwork-v${currentVersion.versionNumber}.${assetExtension(mediaType)}`}
            >
              下载立绘
            </a>
          </Button>
        ) : (
          <Button variant="secondary" disabled>
            下载立绘
          </Button>
        )}
        <Button variant="secondary" onClick={onRegenerate}>
          重新生成
        </Button>
        <Button variant="primary" onClick={onOpenLayered}>
          打开分层
        </Button>
      </WorkbenchActionBar>
      <Dialog
        open={lightbox}
        onOpenChange={setLightbox}
        title="当前立绘原图"
        className={styles['wb3-lightbox-dialog']!}
        footer={
          <>
            <Button
              variant="quiet"
              size="sm"
              data-testid="wb3-lightbox-zoom-out"
              disabled={zoom <= 1}
              onClick={() => setClampedZoom(zoom - 0.25)}
            >
              缩小
            </Button>
            <span className={styles['wb3-lightbox-zoom-label']!} data-testid="wb3-lightbox-zoom-label">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              variant="quiet"
              size="sm"
              data-testid="wb3-lightbox-zoom-in"
              disabled={zoom >= 4}
              onClick={() => setClampedZoom(zoom + 0.25)}
            >
              放大
            </Button>
            <Button
              variant="secondary"
              size="sm"
              data-testid="wb3-lightbox-zoom-reset"
              disabled={zoom === 1}
              onClick={() => setClampedZoom(1)}
            >
              适应
            </Button>
          </>
        }
      >
        {url ? (
          <div
            ref={lightboxViewportRef}
            className={styles['wb3-lightbox-viewport']!}
            data-testid="wb3-lightbox-viewport"
            style={{ overflow: zoom > 1 ? 'auto' : 'hidden' }}
          >
            <div className={styles['wb3-lightbox-canvas']!} style={canvasSize}>
              <img
                className={styles['wb3-current-lightbox']!}
                style={renderedSize ?? undefined}
                src={url}
                alt="当前立绘原图"
                onLoad={(event) => {
                  setNaturalSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight
                  })
                }}
              />
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  )
}
