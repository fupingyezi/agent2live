import React, { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Undo2 } from 'lucide-react'
import type {
  ArtProjectDto,
  ArtVersionDto,
  ArtVersionMutationDto,
  PromptVersionSummaryDto
} from '@studio/api'
import { activateArtVersion, createManualArtVersion, queryKeys, uploadAsset } from '@studio/api'
import { useAssetUrl } from '@studio/hooks'
import { formatDateTime } from '@studio/format'
import {
  AsyncButton,
  Button,
  ConfirmDialog,
  Dialog,
  Drawer,
  FileDropZone,
  IconButton,
  InlineNotice,
  StatusPill
} from '@agent2live/design-system'
import type { ForkSource } from '../../ForkDialog'
import { ART_SOURCE_LABELS } from '../../../prompt-labels'
import styles from './VersionHistoryDrawer.module.scss'

const MAX_FILE_BYTES = 20 * 1024 * 1024

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

function errorMessage(error: unknown): string | null {
  if (!error) return null
  return error instanceof Error ? error.message : '操作失败，请重试。'
}

interface ArtThumbProps {
  assetId: string
  label: string
}

const ArtThumb: React.FC<ArtThumbProps> = ({ assetId, label }) => {
  const { url, isLoading } = useAssetUrl(assetId)
  return (
    <div className={styles['art-thumb']!}>
      {url ? <img src={url} alt={label} /> : <span>{isLoading ? '…' : '—'}</span>}
    </div>
  )
}

export interface VersionHistoryDrawerProps {
  open: boolean
  project: ArtProjectDto
  promptVersions: PromptVersionSummaryDto[]
  artVersions: ArtVersionDto[]
  selectedPromptVersionId: string | null
  onClose(): void
  onSelectPromptVersion(versionId: string): void
  onRollback(versionId: string): void
  onViewArtVersion(versionId: string): void
  onFork(source: ForkSource): void
  onMutated(mutation: ArtVersionMutationDto): void
}

export const VersionHistoryDrawer: React.FC<VersionHistoryDrawerProps> = ({
  open,
  project,
  promptVersions,
  artVersions,
  selectedPromptVersionId,
  onClose,
  onSelectPromptVersion,
  onRollback,
  onViewArtVersion,
  onFork,
  onMutated
}) => {
  const queryClient = useQueryClient()
  const [pendingActivate, setPendingActivate] = useState<ArtVersionDto | null>(null)
  const [selectedArtId, setSelectedArtId] = useState<string | null>(project.activeVersionId)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const invalidate = (): Promise<unknown> =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.artVersions(project.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.workspace(project.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.lineages }),
      queryClient.invalidateQueries({ queryKey: queryKeys.characters })
    ])

  const activateMutation = useMutation({
    mutationFn: (version: ArtVersionDto) => {
      const active = artVersions.find((item) => item.id === project.activeVersionId) ?? null
      const reason =
        active && version.versionNumber < active.versionNumber ? ('rollback' as const) : ('switch' as const)
      return activateArtVersion(project.id, version.id, reason, project.rowVersion)
    },
    onSuccess: async (mutation) => {
      setPendingActivate(null)
      onMutated(mutation)
      await invalidate()
    }
  })

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('请选择图片。')
      if (!ACCEPTED_TYPES.has(file.type)) throw new Error('仅支持 PNG/JPEG/WEBP。')
      if (file.size > MAX_FILE_BYTES) throw new Error('图片超过 20MB。')
      const asset = await uploadAsset(file)
      return createManualArtVersion(project.id, asset.id, project.rowVersion)
    },
    onSuccess: async (mutation) => {
      setUploadOpen(false)
      setFile(null)
      onMutated(mutation)
      await invalidate()
    }
  })

  const pendingPrompt = [...promptVersions].sort((left, right) => right.versionNumber - left.versionNumber)
  const pendingArt = [...artVersions].sort((left, right) => right.versionNumber - left.versionNumber)
  const mutationError = errorMessage(activateMutation.error) ?? errorMessage(uploadMutation.error)

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="版本历史"
      side="right"
      modal={false}
      busy={pendingActivate !== null || uploadOpen}
      className={styles['drawer']!}
    >
      <div className={styles['content']!}>
        {mutationError ? (
          <div role="alert">
            <InlineNotice tone="danger">{mutationError}</InlineNotice>
          </div>
        ) : null}

        <section className={styles['section']!}>
          <p className={styles['count']!}>{`共 ${pendingPrompt.length} 版`}</p>
          {pendingPrompt.length === 0 ? (
            <p className="muted">还没有提示词版本。保存当前修改后会出现在这里。</p>
          ) : (
            <div className={styles['list']!}>
              {pendingPrompt.map((version) => {
                const current = version.id === project.activePromptVersionId
                const selected = version.id === selectedPromptVersionId
                return (
                  <div
                    key={version.id}
                    className={[styles['row']!, selected ? styles['is-selected']! : '']
                      .filter(Boolean)
                      .join(' ')}
                    data-testid="version-drawer-prompt-row"
                    data-version-id={version.id}
                  >
                    <div className={styles['row-main']!}>
                      <button
                        type="button"
                        className={styles['row-select']!}
                        onClick={() => onSelectPromptVersion(version.id)}
                      >
                        <strong>第 {version.versionNumber} 版</strong>
                        <span>{formatDateTime(version.createdAt)}</span>
                      </button>
                      {current ? (
                        <StatusPill label="当前" tone="success" />
                      ) : selected ? (
                        <IconButton
                          label="回到这版"
                          title="回到这版"
                          variant="ghost"
                          onClick={() => onRollback(version.id)}
                        >
                          <Undo2 size={16} aria-hidden="true" />
                        </IconButton>
                      ) : null}
                    </div>
                    {selected ? (
                      <Button
                        type="button"
                        variant="quiet"
                        size="sm"
                        onClick={() =>
                          onFork({
                            kind: 'prompt_version',
                            versionId: version.id,
                            versionLabel: `提示词 v${version.versionNumber}`
                          })
                        }
                      >
                        从此版本分支
                      </Button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className={styles['section']!}>
          <header className={styles['section-head']!}>
            <h3>立绘版本</h3>
            <span>{`${pendingArt.length} 版`}</span>
          </header>
          {pendingArt.length === 0 ? (
            <p className="muted">还没有美术版本。生成候选或手工上传后会出现在这里。</p>
          ) : (
            <div className={styles['list']!}>
              {pendingArt.map((version) => {
                const active = version.id === project.activeVersionId
                const selected = version.id === selectedArtId
                const busy = activateMutation.isPending && activateMutation.variables?.id === version.id
                return (
                  <div
                    key={version.id}
                    className={[styles['art-row']!, selected ? styles['is-selected']! : '']
                      .filter(Boolean)
                      .join(' ')}
                    data-testid="version-drawer-art-row"
                    data-version-id={version.id}
                    data-active={active || undefined}
                  >
                    <button
                      type="button"
                      className={styles['art-main']!}
                      onClick={() => setSelectedArtId(version.id)}
                    >
                      <ArtThumb
                        assetId={version.artworkAssetId}
                        label={`第 ${version.versionNumber} 版立绘`}
                      />
                      <span className={styles['art-body']!}>
                        <span className={styles['art-head']!}>
                          <strong>第 {version.versionNumber} 版</strong>
                        </span>
                        <span className={styles['art-meta']!}>
                          {ART_SOURCE_LABELS[version.sourceKind]} · {formatDateTime(version.createdAt)}
                        </span>
                      </span>
                    </button>
                    {selected ? (
                      <div className={styles['art-actions']!}>
                        <Button
                          type="button"
                          variant="quiet"
                          size="sm"
                          onClick={() => {
                            onClose()
                            onViewArtVersion(version.id)
                          }}
                        >
                          查看
                        </Button>
                        {!active ? (
                          <AsyncButton
                            type="button"
                            variant="quiet"
                            size="sm"
                            busy={busy}
                            busyLabel="切换中…"
                            onClick={() => setPendingActivate(version)}
                          >
                            设为当前立绘
                          </AsyncButton>
                        ) : null}
                        <Button
                          type="button"
                          variant="quiet"
                          size="sm"
                          onClick={() =>
                            onFork({
                              kind: 'art_version',
                              versionId: version.id,
                              versionLabel: `美术 v${version.versionNumber}`
                            })
                          }
                        >
                          从此版本分支
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
          <div className={styles['upload']!}>
            {project.activePromptVersionId ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => setUploadOpen(true)}>
                手工上传立绘
              </Button>
            ) : (
              <p className="muted">先提交一个提示词版本，手工美术版本需要记录来源提示词。</p>
            )}
          </div>
        </section>

        <p className={styles['note']!}>回退旧版会新开一版，原来的版本留在列表里。</p>
      </div>

      <ConfirmDialog
        open={pendingActivate !== null}
        title={`把美术 v${pendingActivate?.versionNumber ?? ''} 设为当前立绘？`}
        confirmLabel="切换"
        busy={activateMutation.isPending}
        onCancel={() => setPendingActivate(null)}
        onConfirm={() => {
          if (pendingActivate) activateMutation.mutate(pendingActivate)
        }}
      >
        <p>只会切换当前立绘指针；当前 PromptVersion 和它的参考图不会改变。</p>
      </ConfirmDialog>

      <Dialog
        open={uploadOpen}
        title="手工上传立绘"
        description="上传后会创建不可变 ArtVersion 并设为当前立绘。"
        onOpenChange={(next) => {
          if (!next && !uploadMutation.isPending) setUploadOpen(false)
        }}
      >
        <div className={styles['upload-dialog']!}>
          <FileDropZone
            label="选择手工美术图片"
            accept="image/png,image/jpeg,image/webp"
            disabled={uploadMutation.isPending}
            onFiles={(files) => {
              const next = files[0] ?? null
              setUploadError(null)
              if (next && !ACCEPTED_TYPES.has(next.type)) setUploadError('仅支持 PNG/JPEG/WEBP。')
              else if (next && next.size > MAX_FILE_BYTES) setUploadError('图片超过 20MB。')
              setFile(next)
            }}
          >
            <strong>{file ? file.name : '选择图片'}</strong>
            <span>
              {file ? `${Math.round(file.size / 1024)}KB · 点击可更换` : 'PNG/JPEG/WEBP，最大 20MB'}
            </span>
          </FileDropZone>
          {uploadError ? (
            <div role="alert">
              <InlineNotice tone="danger">{uploadError}</InlineNotice>
            </div>
          ) : null}
          <div className={styles['upload-actions']!}>
            <Button
              type="button"
              variant="quiet"
              disabled={uploadMutation.isPending}
              onClick={() => setUploadOpen(false)}
            >
              取消
            </Button>
            <AsyncButton
              type="button"
              busy={uploadMutation.isPending}
              busyLabel="创建中…"
              disabled={!file || Boolean(uploadError) || uploadMutation.isPending}
              onClick={() => uploadMutation.mutate()}
            >
              创建并激活
            </AsyncButton>
          </div>
        </div>
      </Dialog>
    </Drawer>
  )
}
