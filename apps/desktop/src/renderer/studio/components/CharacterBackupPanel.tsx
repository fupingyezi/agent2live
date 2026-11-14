import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AsyncButton,
  CountBadge,
  EmptyState,
  InlineNotice,
  SectionHeader,
  StatusPill,
  SurfaceCard,
  type StatusTone
} from '@agent2live/design-system'
import { ApiError } from '../api/client'
import { queryKeys } from '../api/keys'
import { createBackup, downloadBackup, listBackups } from '../api/queries'
import type { CharacterBackupDto } from '../api/types'
import { formatBytes, formatDateTime } from '../format'
import { StudioError } from './StudioError'
import { StudioLoading } from './StudioLoading'

const TERMINAL = new Set<CharacterBackupDto['status']>([
  'succeeded',
  'failed',
  'cancelled',
  'unknown_outcome'
])

const STATUS_LABELS: Record<CharacterBackupDto['status'], string> = {
  queued: '排队中',
  leased: '准备中',
  running: '导出中',
  waiting_user: '等待中',
  succeeded: '已完成',
  failed: '失败',
  retrying: '重试中',
  cancelled: '已取消',
  unknown_outcome: '结果未知'
}

const STATUS_TONES: Record<CharacterBackupDto['status'], StatusTone> = {
  queued: 'neutral',
  leased: 'accent',
  running: 'accent',
  waiting_user: 'warning',
  succeeded: 'success',
  failed: 'danger',
  retrying: 'warning',
  cancelled: 'neutral',
  unknown_outcome: 'danger'
}

export function backupFilename(characterId: string, backupId: string): string {
  return `agent2live-${characterId}-${backupId}.zip`
}

export interface CharacterBackupPanelProps {
  characterId: string
}

export const CharacterBackupPanel: React.FC<CharacterBackupPanelProps> = ({ characterId }) => {
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const query = useQuery({
    queryKey: queryKeys.backups(characterId),
    queryFn: ({ signal }) => listBackups(characterId, signal),
    refetchInterval: (current) => {
      const items = current.state.data ?? []
      return items.some((item) => !TERMINAL.has(item.status)) ? 1500 : false
    }
  })

  const invalidate = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: queryKeys.backups(characterId) })

  const onCreate = async (): Promise<void> => {
    if (creating) return
    setCreating(true)
    setError(null)
    setNotice(null)
    try {
      await createBackup(characterId)
      await invalidate()
      setNotice('备份任务已创建，完成后可下载。')
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '创建备份失败，请重试。')
    } finally {
      setCreating(false)
    }
  }

  const onDownload = async (backup: CharacterBackupDto): Promise<void> => {
    if (downloadingId) return
    setDownloadingId(backup.id)
    setError(null)
    try {
      const blob = await downloadBackup(backup.id)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = backupFilename(characterId, backup.id)
      anchor.rel = 'noopener'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '下载备份失败，请重试。')
    } finally {
      setDownloadingId(null)
    }
  }

  const items = query.data ?? []

  return (
    <SurfaceCard asChild>
      <section className="backup-panel" data-testid="backup-panel">
        <SectionHeader title="角色导出" actions={<CountBadge value={items.length} />} />
        <p className="backup-description">
          导出角色、项目、提示词版本、美术版本与被引用素材的 ZIP 备份；不包含 provider 连接、密钥或任务日志。
        </p>
        <AsyncButton
          className="backup-create"
          data-testid="create-backup"
          busy={creating}
          busyLabel="创建中…"
          onClick={() => {
            void onCreate()
          }}
        >
          创建备份
        </AsyncButton>

        {notice ? (
          <div className="backup-notice">
            <InlineNotice tone="success">{notice}</InlineNotice>
          </div>
        ) : null}
        {error ? (
          <div className="backup-notice" role="alert">
            <InlineNotice tone="danger">{error}</InlineNotice>
          </div>
        ) : null}

        {query.isPending ? <StudioLoading label="正在加载备份…" /> : null}
        {query.isError ? (
          <StudioError
            error={query.error}
            onRetry={() => {
              void query.refetch()
            }}
          />
        ) : null}
        {query.isSuccess && items.length === 0 ? (
          <div data-testid="backup-empty">
            <EmptyState compact title="还没有备份" description="创建后会在后台导出；完成即可下载 ZIP。" />
          </div>
        ) : null}
        {items.length > 0 ? (
          <ul className="backup-list">
            {items.map((backup) => (
              <li key={backup.id} className="backup-row" data-testid="backup-row" data-backup-id={backup.id}>
                <div className="backup-row-main">
                  <StatusPill label={STATUS_LABELS[backup.status]} tone={STATUS_TONES[backup.status]} />
                  <span className="backup-meta">{formatDateTime(backup.createdAt)}</span>
                  <span className="backup-meta">{formatBytes(backup.fileSize)}</span>
                </div>
                {backup.errorCode ? (
                  <InlineNotice tone="danger">
                    <code>{backup.errorCode}</code>
                  </InlineNotice>
                ) : null}
                {backup.status === 'succeeded' ? (
                  <AsyncButton
                    className="backup-download"
                    variant="secondary"
                    data-testid="download-backup"
                    busy={downloadingId === backup.id}
                    busyLabel="下载中…"
                    onClick={() => {
                      void onDownload(backup)
                    }}
                  >
                    下载 ZIP
                  </AsyncButton>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </SurfaceCard>
  )
}
