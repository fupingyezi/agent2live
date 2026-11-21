import React from 'react'
import { Undo2 } from 'lucide-react'
import type { ArtProjectDto, PromptVersionSummaryDto } from '@studio/api'
import { formatDateTime } from '@studio/format'
import { Button, Drawer, IconButton, StatusPill } from '@agent2live/design-system'
import styles from './VersionHistoryDrawer.module.scss'

export interface VersionHistoryDrawerProps {
  open: boolean
  project: ArtProjectDto
  promptVersions: PromptVersionSummaryDto[]
  selectedPromptVersionId: string | null
  onClose(): void
  onSelectPromptVersion(versionId: string): void
  onRollback(versionId: string): void
}

export const VersionHistoryDrawer: React.FC<VersionHistoryDrawerProps> = ({
  open,
  project,
  promptVersions,
  selectedPromptVersionId,
  onClose,
  onSelectPromptVersion,
  onRollback
}) => {
  const ordered = [...promptVersions].sort((left, right) => right.versionNumber - left.versionNumber)

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="版本历史"
      side="right"
      modal={false}
      className={styles['drawer']!}
    >
      <div className={styles['content']!}>
        <section className={styles['section']!} data-testid="version-drawer-prompt-history">
          <header className={styles['section-head']!}>
            <h3>提示词版本</h3>
            <span>{`${ordered.length} 版`}</span>
          </header>
          <p className={styles['note']!}>
            立绘只维护当前一张。这里保留提示词修改记录，方便回到某版提示词后继续修改并重新生成。
          </p>
          {ordered.length === 0 ? (
            <p className="muted">还没有提示词版本。保存当前修改后会出现在这里。</p>
          ) : (
            <div className={styles['list']!}>
              {ordered.map((version) => {
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
                        onClick={() => onSelectPromptVersion(version.id)}
                      >
                        查看此版
                      </Button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </Drawer>
  )
}
