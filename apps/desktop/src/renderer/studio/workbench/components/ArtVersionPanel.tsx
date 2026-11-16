import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  ArtProjectDto,
  ArtVersionDto,
  ArtVersionMutationDto,
  PromptVersionSummaryDto
} from '@studio/api'
import { activateArtVersion, createManualArtVersion, uploadAsset } from '@studio/api'
import { queryKeys } from '@studio/api'
import { useAssetUrl } from '@studio/hooks'
import { formatDateTime, shortId } from '@studio/format'
import {
  AsyncButton,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  FileDropZone,
  InlineNotice,
  KeyValueList,
  SectionHeader,
  Select,
  StatusPill
} from '@agent2live/design-system'

import { ReferenceSetEditor } from './ReferenceSetEditor'

import type { ForkSource } from './ForkDialog'

const MAX_FILE_BYTES = 20 * 1024 * 1024

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

interface ArtPreviewProps {
  assetId: string
}

const ArtPreview: React.FC<ArtPreviewProps> = ({ assetId }) => {
  const { url, isLoading, error } = useAssetUrl(assetId)
  return (
    <div className="art-preview">
      {url ? (
        <img src={url} alt="当前选中美术版本" />
      ) : (
        <span>{isLoading ? '加载中…' : error ? '无法加载' : '—'}</span>
      )}
    </div>
  )
}

function errorMessage(error: unknown): string | null {
  if (!error) return null
  return error instanceof Error ? error.message : '操作失败，请重试。'
}

export interface ArtVersionPanelProps {
  project: ArtProjectDto
  artVersions: ArtVersionDto[]
  promptVersions: PromptVersionSummaryDto[]
  onMutated: (mutation: ArtVersionMutationDto) => void
  onFork: (source: ForkSource) => void
}

export const ArtVersionPanel: React.FC<ArtVersionPanelProps> = ({
  project,
  artVersions,
  promptVersions,
  onMutated,
  onFork
}) => {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(project.activeVersionId)
  useEffect(() => {
    if (project.activeVersionId) setSelectedId(project.activeVersionId)
  }, [project.activeVersionId])
  const selected = useMemo(
    () =>
      artVersions.find((version) => version.id === selectedId) ??
      artVersions.find((version) => version.id === project.activeVersionId) ??
      artVersions[0] ??
      null,
    [artVersions, selectedId, project.activeVersionId]
  )
  const [file, setFile] = useState<File | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [manualDialogOpen, setManualDialogOpen] = useState(false)
  const [confirmActivate, setConfirmActivate] = useState(false)

  const active = artVersions.find((version) => version.id === project.activeVersionId) ?? null
  const selectedPrimary = selected?.references.find((reference) => reference.isPrimary) ?? null
  const promptById = new Map(promptVersions.map((version) => [version.id, version]))

  const invalidate = (): Promise<unknown> =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.artVersions(project.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.workspace(project.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.lineages }),
      queryClient.invalidateQueries({ queryKey: queryKeys.characters })
    ])

  const manualMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('请选择图片。')
      if (!ACCEPTED_TYPES.has(file.type)) throw new Error('仅支持 PNG/JPEG/WEBP。')
      if (file.size > MAX_FILE_BYTES) throw new Error('图片超过 20MB。')
      const asset = await uploadAsset(file)
      return createManualArtVersion(project.id, asset.id, project.rowVersion)
    },
    onSuccess: async (mutation) => {
      setManualDialogOpen(false)
      setFile(null)
      setSelectedId(mutation.artVersion.id)
      onMutated(mutation)
      await invalidate()
    }
  })

  const activateMutation = useMutation({
    mutationFn: async (version: ArtVersionDto) => {
      const reason =
        active && version.versionNumber < active.versionNumber ? ('rollback' as const) : ('switch' as const)
      return activateArtVersion(project.id, version.id, reason, project.rowVersion)
    },
    onSuccess: async (mutation) => {
      setConfirmActivate(false)
      setSelectedId(mutation.artVersion.id)
      onMutated(mutation)
      await invalidate()
    }
  })

  const handleMutated = async (mutation: ArtVersionMutationDto): Promise<void> => {
    setSelectedId(mutation.artVersion.id)
    onMutated(mutation)
    await invalidate()
  }

  const mutationError = errorMessage(manualMutation.error) ?? errorMessage(activateMutation.error)

  return (
    <section
      className="art-version-panel"
      data-testid="art-version-panel"
      data-active-version-id={project.activeVersionId ?? ''}
    >
      <SectionHeader
        title="美术版本"
        description="立绘"
        {...(active
          ? { actions: <StatusPill label={`active v${active.versionNumber}`} tone="accent" /> }
          : {})}
      />

      {mutationError ? (
        <div role="alert">
          <InlineNotice tone="danger">{mutationError}</InlineNotice>
        </div>
      ) : null}

      {selected ? (
        <>
          <div className="art-version-detail">
            {selectedPrimary ? <ArtPreview assetId={selectedPrimary.assetId} /> : null}
            <div className="art-version-facts">
              <KeyValueList
                items={[
                  { label: '版本', value: `v${selected.versionNumber}` },
                  {
                    label: '提示词',
                    value: promptById.get(selected.promptVersionId)?.versionNumber
                      ? `v${promptById.get(selected.promptVersionId)!.versionNumber}`
                      : shortId(selected.promptVersionId)
                  },
                  { label: '创建', value: formatDateTime(selected.createdAt) },
                  {
                    label: '内容哈希',
                    value: <code title={selected.contentHash}>{shortId(selected.contentHash, 14)}</code>
                  }
                ]}
              />
              <div className="art-version-actions">
                {selected.id !== project.activeVersionId ? (
                  <AsyncButton
                    type="button"
                    busy={activateMutation.isPending}
                    busyLabel="切换中…"
                    disabled={activateMutation.isPending}
                    onClick={() => setConfirmActivate(true)}
                  >
                    设为当前参考
                  </AsyncButton>
                ) : (
                  <StatusPill label="当前参考" tone="success" />
                )}
                <Button
                  type="button"
                  variant="quiet"
                  size="sm"
                  onClick={() =>
                    onFork({
                      kind: 'art_version',
                      versionId: selected.id,
                      versionLabel: `美术 v${selected.versionNumber}`
                    })
                  }
                >
                  从此版本分支
                </Button>
              </div>
            </div>
          </div>

          {artVersions.length > 1 ? (
            <Field label="查看版本">
              <Select value={selected.id} onValueChange={(value) => setSelectedId(value)}>
                {artVersions.map((version) => (
                  <option key={version.id} value={version.id}>
                    v{version.versionNumber}
                    {version.id === project.activeVersionId ? '（当前）' : ''}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <ReferenceSetEditor
            project={project}
            version={selected}
            disabled={activateMutation.isPending || manualMutation.isPending}
            onMutated={(mutation) => {
              void handleMutated(mutation)
            }}
          />
        </>
      ) : (
        <EmptyState title="还没有美术版本" description="生成候选或手工上传后会出现在这里。" />
      )}

      <div className="manual-art">
        <SectionHeader title="手工上传" description="创建并激活一个新的美术版本。" />
        {!project.activePromptVersionId ? (
          <p className="muted">先提交一个提示词版本，手工美术版本需要记录来源提示词。</p>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setLocalError(null)
              setManualDialogOpen(true)
            }}
          >
            手工上传立绘
          </Button>
        )}
      </div>

      <Dialog
        open={manualDialogOpen}
        title="手工上传立绘"
        description="上传后会创建不可变 ArtVersion 并设为当前参考。"
        onOpenChange={(open) => {
          if (!open && !manualMutation.isPending) setManualDialogOpen(false)
        }}
      >
        {!project.activePromptVersionId ? (
          <InlineNotice tone="warning">先提交一个提示词版本，才能上传立绘。</InlineNotice>
        ) : (
          <div className="manual-art-dialog">
            <FileDropZone
              label="选择手工美术图片"
              accept="image/png,image/jpeg,image/webp"
              disabled={manualMutation.isPending}
              onFiles={(files) => {
                const next = files[0] ?? null
                setLocalError(null)
                if (next && !ACCEPTED_TYPES.has(next.type)) setLocalError('仅支持 PNG/JPEG/WEBP。')
                else if (next && next.size > MAX_FILE_BYTES) setLocalError('图片超过 20MB。')
                setFile(next)
              }}
            >
              <strong>{file ? file.name : '选择图片'}</strong>
              <span>
                {file ? `${Math.round(file.size / 1024)}KB · 点击可更换` : 'PNG/JPEG/WEBP，最大 20MB'}
              </span>
            </FileDropZone>
            {localError ? (
              <div role="alert">
                <InlineNotice tone="danger">{localError}</InlineNotice>
              </div>
            ) : null}
            <div className="manual-art-dialog-actions">
              <Button
                type="button"
                variant="quiet"
                disabled={manualMutation.isPending}
                onClick={() => setManualDialogOpen(false)}
              >
                取消
              </Button>
              <AsyncButton
                type="button"
                busy={manualMutation.isPending}
                busyLabel="创建中…"
                disabled={!file || Boolean(localError) || manualMutation.isPending}
                onClick={() => manualMutation.mutate()}
              >
                创建并激活
              </AsyncButton>
            </div>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={confirmActivate}
        title={`把美术 v${selected?.versionNumber ?? ''} 设为当前参考？`}
        confirmLabel="切换"
        busy={activateMutation.isPending}
        onCancel={() => setConfirmActivate(false)}
        onConfirm={() => {
          if (selected) activateMutation.mutate(selected)
        }}
      >
        <p>下一次生成会以该版本作为主参考。历史版本不会被删除。</p>
      </ConfirmDialog>
    </section>
  )
}
