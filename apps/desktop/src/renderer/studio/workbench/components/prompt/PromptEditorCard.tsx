import React, { useEffect, useState } from 'react'
import type { PromptSpecV2 } from '@studio/api'
import {
  Button,
  AsyncButton,
  ChipGroup,
  EmptyState,
  InlineNotice,
  TextField
} from '@agent2live/design-system'
import characterEmptyArt from '@studio/assets/empty-states/character-empty.png'
import {
  promptBlockGroups,
  promptFilterModel,
  shadowedBlockIds,
  type PromptFilter
} from '../../prompt-diagnostics'
import { PromptBlockGroupView } from './PromptBlockGroupView'

export interface PromptEditorCardProps {
  characterTitle: string
  characterSummary: string | null
  spec: PromptSpecV2 | null
  referenceCount: number
  readOnly: boolean
  dirty: boolean
  canCommit: boolean
  busy: boolean
  filter: PromptFilter
  droppedBlockIds: string[]
  promptVersionError: string | null
  submitting: boolean
  error: string | null
  onFilterChange(filter: PromptFilter): void
  onRename?(): void
  onOpenBlock(blockId: string, negative: boolean): void
  onNewBlock(negative: boolean): void
  onOpenAiRewrite(intent: string): void
  onOpenReverse(): void
  onOpenFullPrompt?(): void
  onSubmitVersion(): void
}

export const PromptEditorCard: React.FC<PromptEditorCardProps> = ({
  characterTitle,
  characterSummary,
  spec,
  referenceCount,
  readOnly,
  dirty,
  canCommit,
  busy,
  filter,
  droppedBlockIds,
  promptVersionError,
  submitting,
  error,
  onFilterChange,
  onRename,
  onOpenBlock,
  onNewBlock,
  onOpenAiRewrite,
  onOpenReverse,
  onOpenFullPrompt,
  onSubmitVersion
}) => {
  const [intent, setIntent] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const total = spec ? spec.blocks.length + spec.negativeBlocks.length : 0
  const model = spec ? promptFilterModel(spec) : { categories: [], statuses: [], total: 0 }
  const groups = spec ? promptBlockGroups(spec, filter) : []
  const shadowed = spec ? shadowedBlockIds(spec) : new Set<string>()
  const dropped = new Set(droppedBlockIds)

  useEffect(() => {
    if (!spec) {
      setCollapsed({})
      return
    }
    const next: Record<string, boolean> = {}
    promptBlockGroups(spec, filter).forEach((group, index) => {
      next[group.id] = total > 12 && index > 0
    })
    setCollapsed(next)
  }, [filter, total, spec, spec?.blocks.length, spec?.negativeBlocks.length])

  const submitIntent = (): void => {
    if (busy) return
    const value = intent.trim()
    if (value.length === 0) return
    onOpenAiRewrite(value)
    setIntent('')
  }

  return (
    <section className="wb3-card wb3-prompt-card" data-testid="wb3-prompt-editor">
      <header className="wb3-prompt-character">
        <div className="wb3-character-copy">
          <h2>{characterTitle}</h2>
          <span>{characterSummary || '未填写简介'}</span>
        </div>
        {onRename ? (
          <Button variant="quiet" size="sm" disabled={readOnly || busy} onClick={onRename}>
            改名
          </Button>
        ) : null}
      </header>

      <div className="wb3-prompt-heading">
        <div className="wb3-prompt-title">
          <h3>提示词</h3>
          <span className="wb3-pill">
            {total} 块 · {model.categories.length} 组
          </span>
        </div>
        <div className="wb3-prompt-heading-actions">
          {onOpenFullPrompt ? (
            <Button variant="quiet" size="sm" disabled={readOnly || busy} onClick={onOpenFullPrompt}>
              完整提示词
            </Button>
          ) : null}
          <Button
            variant="quiet"
            size="sm"
            disabled={readOnly || busy}
            onClick={() => onOpenAiRewrite(intent.trim())}
          >
            AI 改写
          </Button>
          <Button variant="secondary" size="sm" disabled={readOnly || busy} onClick={() => onNewBlock(false)}>
            新增块
          </Button>
        </div>
      </div>

      <div className="wb3-ai-bar">
        <TextField
          aria-label="AI 改写指令"
          value={intent}
          disabled={readOnly || busy}
          placeholder="说一句要改的地方，比如发色偏冷一点"
          onValueChange={setIntent}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submitIntent()
          }}
        />
        <Button
          variant="primary"
          size="sm"
          disabled={readOnly || busy || intent.trim().length === 0 || !spec}
          onClick={submitIntent}
        >
          生成建议
        </Button>
      </div>

      <div className="wb3-filter-row">
        <ChipGroup
          ariaLabel="按分类筛选提示词块"
          value={filter}
          onValueChange={(value) => onFilterChange(value as PromptFilter)}
          options={[
            { id: 'all', label: '全部', count: model.total },
            ...model.categories.map((item) => ({
              id: item.id,
              label: item.label,
              count: item.count
            }))
          ]}
        />
        {model.statuses.length > 0 ? (
          <>
            <span className="wb3-filter-divider" aria-hidden="true" />
            <ChipGroup
              ariaLabel="按状态筛选提示词块"
              value={filter}
              onValueChange={(value) => onFilterChange(value as PromptFilter)}
              options={model.statuses.map((item) => ({
                id: item.id,
                label: item.label,
                count: item.count
              }))}
            />
          </>
        ) : null}
      </div>

      <div className="wb3-prompt-scroll">
        {spec === null ? (
          promptVersionError ? (
            <div role="alert">
              <InlineNotice tone="danger">{promptVersionError}</InlineNotice>
            </div>
          ) : (
            <InlineNotice tone="info">正在载入提示词…</InlineNotice>
          )
        ) : total === 0 ? (
          <EmptyState
            icon={<img className="wb3-empty-illustration" src={characterEmptyArt} alt="" />}
            title="还没有提示词块"
            description={`读 ${referenceCount} 张参考图生成一版，或自己写第一块`}
            action={
              <div className="wb3-empty-actions">
                <Button variant="primary" disabled={busy} onClick={onOpenReverse}>
                  读参考图生成
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => onNewBlock(false)}>
                  手动写一版
                </Button>
              </div>
            }
          />
        ) : (
          groups.map((group) => (
            <PromptBlockGroupView
              key={group.id}
              group={group}
              collapsed={collapsed[group.id] ?? false}
              shadowed={shadowed}
              dropped={dropped}
              lockAll={spec.lockAll}
              busy={busy}
              onToggle={() => setCollapsed((current) => ({ ...current, [group.id]: !current[group.id] }))}
              onOpenBlock={onOpenBlock}
            />
          ))
        )}
      </div>

      {error ? (
        <div role="alert" className="wb3-card-error">
          <InlineNotice tone="danger">{error}</InlineNotice>
        </div>
      ) : null}

      <footer className="wb3-card-footer">
        <span>点任意一行打开弹窗编辑　改动提交成新版本</span>
        <AsyncButton
          variant="secondary"
          size="sm"
          busy={submitting}
          busyLabel="提交中…"
          disabled={readOnly || !canCommit || submitting || busy}
          onClick={onSubmitVersion}
        >
          提交为新版本
        </AsyncButton>
      </footer>
    </section>
  )
}
