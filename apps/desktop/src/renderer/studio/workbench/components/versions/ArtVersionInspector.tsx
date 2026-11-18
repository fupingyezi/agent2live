import React, { useState } from 'react'
import type { ArtProjectDto, ArtVersionDto, PromptVersionDto } from '@studio/api'
import { formatDateTime } from '@studio/format'
import { Button, ConfirmDialog, KeyValueList } from '@agent2live/design-system'
import { ART_SOURCE_LABELS, MATERIAL_ROLE_LABELS } from '../../prompt-labels'

export interface ArtVersionInspectorProps {
  project: ArtProjectDto
  version: ArtVersionDto
  promptVersion: PromptVersionDto | null
  parentVersionNumber: number | null
  activating: boolean
  onActivate(): void
  onFork(): void
  onOpenVersions(): void
  onBackToPrompt(): void
}

export const ArtVersionInspector: React.FC<ArtVersionInspectorProps> = ({
  project,
  version,
  promptVersion,
  parentVersionNumber,
  activating,
  onActivate,
  onFork,
  onOpenVersions,
  onBackToPrompt
}) => {
  const [confirmActivate, setConfirmActivate] = useState(false)
  const active = version.id === project.activeVersionId
  const references = promptVersion?.references ?? []
  const mainReference = references[0]

  return (
    <aside className="wb3-version-inspector" data-testid="wb3-art-version-inspector">
      <header className="wb3-inspector-head">
        <h2>版本信息</h2>
        <Button variant="quiet" size="sm" onClick={onOpenVersions}>
          管理全部
        </Button>
      </header>
      <KeyValueList
        items={[
          { label: '来源', value: ART_SOURCE_LABELS[version.sourceKind] },
          {
            label: '参考',
            value: mainReference
              ? `${references.length} 张 · 主参考 ${MATERIAL_ROLE_LABELS[mainReference.role]}`
              : '无'
          },
          {
            label: '分支',
            value: parentVersionNumber === null ? '—' : `第 ${parentVersionNumber} 版`
          },
          { label: '时间', value: formatDateTime(version.createdAt) }
        ]}
      />

      <section className="wb3-inspector-section">
        <h3>依据的提示词</h3>
        {promptVersion ? (
          <div className="wb3-inspector-card">
            <div>
              <strong>第 {promptVersion.versionNumber} 版</strong>
              <span>
                {promptVersion.state.blocks.length + promptVersion.state.negativeBlocks.length} 块 ·{' '}
                {promptVersion.references.length} 张参考图
              </span>
              <small>提交 {formatDateTime(promptVersion.createdAt)}</small>
            </div>
            <Button variant="quiet" size="sm" onClick={onBackToPrompt}>
              查看
            </Button>
          </div>
        ) : (
          <p className="wb3-overview-muted">提示词版本加载中…</p>
        )}
      </section>

      <section className="wb3-inspector-section">
        <h3>版本操作</h3>
        <button
          type="button"
          className="wb3-action-card"
          disabled={active || activating}
          onClick={() => setConfirmActivate(true)}
        >
          <span>
            <strong>{active ? '当前参考' : '设为当前参考'}</strong>
            <small>下次生成以这张为主参考；不覆盖任何旧版本</small>
          </span>
          <span aria-hidden="true">→</span>
        </button>
        <button type="button" className="wb3-action-card" onClick={onFork}>
          <span>
            <strong>从此版本分支</strong>
            <small>旧版原样保留</small>
          </span>
          <span aria-hidden="true">→</span>
        </button>
      </section>
      <ConfirmDialog
        open={confirmActivate}
        title="设为当前参考？"
        confirmLabel="设为当前参考"
        busy={activating}
        onCancel={() => setConfirmActivate(false)}
        onConfirm={() => {
          setConfirmActivate(false)
          onActivate()
        }}
      >
        <p>只会把当前参考指向这一版，不会复制或覆盖任何版本；下次生成以它为主参考。</p>
      </ConfirmDialog>
    </aside>
  )
}
