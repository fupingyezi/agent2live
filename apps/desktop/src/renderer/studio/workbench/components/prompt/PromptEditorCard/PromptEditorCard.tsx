import React, { useEffect, useState } from 'react'
import type { PromptMaterialRef, PromptSpecV2 } from '@studio/api'
import { useAssetUrl } from '@studio/hooks'
import { Button, ChipGroup, EmptyState, InlineNotice, TextField } from '@agent2live/design-system'
import characterEmptyArt from '@studio/assets/empty-states/character-empty.png'
import { MATERIAL_ROLE_LABELS } from '../../../prompt-labels'
import {
  promptBlockGroups,
  promptFilterModel,
  shadowedBlockIds,
  type PromptFilter
} from '../../../prompt-diagnostics'
import { PromptBlockGroupView } from '../PromptBlockGroupView'
import styles from './PromptEditorCard.module.scss'

interface ReferenceThumbProps {
  reference: PromptMaterialRef
  index: number
}

const ReferenceThumb: React.FC<ReferenceThumbProps> = ({ reference, index }) => {
  const { url } = useAssetUrl(reference.assetId)
  const label = MATERIAL_ROLE_LABELS[reference.role]
  return (
    <figure className={styles['wb3-reference-thumb']!} data-testid="wb3-reference-thumb">
      <span className={styles['wb3-reference-image']!}>
        {url ? <img src={url} alt={`${label}参考图 ${index + 1}`} /> : <span aria-hidden="true" />}
      </span>
      <figcaption>{label}</figcaption>
    </figure>
  )
}

export interface PromptEditorCardProps {
  characterTitle: string
  characterSummary: string | null
  spec: PromptSpecV2 | null
  referenceCount: number
  readOnly: boolean
  busy: boolean
  filter: PromptFilter
  droppedBlockIds: string[]
  promptVersionError: string | null
  error: string | null
  onFilterChange(filter: PromptFilter): void
  onRename?(): void
  onOpenBlock(blockId: string, negative: boolean): void
  onNewBlock(negative: boolean): void
  onOpenAiRewrite(intent: string): void
  onOpenReverse(): void
  onOpenFullPrompt?(): void
  onOpenReferences(): void
}

export const PromptEditorCard: React.FC<PromptEditorCardProps> = ({
  characterTitle,
  characterSummary,
  spec,
  referenceCount,
  readOnly,
  busy,
  filter,
  droppedBlockIds,
  promptVersionError,
  error,
  onFilterChange,
  onRename,
  onOpenBlock,
  onNewBlock,
  onOpenAiRewrite,
  onOpenReverse,
  onOpenFullPrompt,
  onOpenReferences
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
    <section
      className={`${styles['wb3-card']!} ${styles['wb3-prompt-card']!}`}
      data-testid="wb3-prompt-editor"
    >
      <header className={styles['wb3-prompt-character']!}>
        <div className={styles['wb3-character-copy']!}>
          <h2>{characterTitle}</h2>
        </div>
        {onRename ? (
          <Button variant="quiet" size="sm" disabled={readOnly || busy} onClick={onRename}>
            改名
          </Button>
        ) : null}
      </header>

      <div className={styles['wb3-prompt-heading']!}>
        <div className={styles['wb3-prompt-title']!}>
          <h3>提示词</h3>
        </div>
        <div className={styles['wb3-prompt-heading-actions']!}>
          {onOpenFullPrompt ? (
            <Button variant="quiet" size="sm" disabled={readOnly || busy} onClick={onOpenFullPrompt}>
              完整提示词
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" disabled={readOnly || busy} onClick={() => onNewBlock(false)}>
            新增条目
          </Button>
        </div>
      </div>

      <div className={styles['wb3-ai-bar']!}>
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

      <div className={styles['wb3-filter-row']!}>
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
            <span className={styles['wb3-filter-divider']!} aria-hidden="true" />
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

      <div className={styles['wb3-prompt-scroll']!}>
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
            icon={<img className={styles['wb3-empty-illustration']!} src={characterEmptyArt} alt="" />}
            title="还没有提示词块"
            description={`读 ${referenceCount} 张参考图生成一版，或自己写第一块`}
            action={
              <div className={styles['wb3-empty-actions']!}>
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
        <div role="alert" className={styles['wb3-card-error']!}>
          <InlineNotice tone="danger">{error}</InlineNotice>
        </div>
      ) : null}

      <section className={styles['wb3-reference-section']!}>
        <div className={styles['wb3-reference-head']!}>
          <h3>{`参考图 ${referenceCount} / 14`}</h3>
          <Button variant="quiet" size="sm" data-testid="wb3-open-references" onClick={onOpenReferences}>
            查看全部
          </Button>
        </div>
        {spec && spec.materialRefs.length > 0 ? (
          <div className={styles['wb3-reference-row']!}>
            {spec.materialRefs.slice(0, 6).map((reference, index) => (
              <ReferenceThumb key={reference.assetId} reference={reference} index={index} />
            ))}
            {spec.materialRefs.length < 14 ? (
              <button
                type="button"
                className={styles['wb3-reference-add']!}
                aria-label="添加参考图片"
                disabled={readOnly}
                onClick={onOpenReferences}
              >
                +
              </button>
            ) : null}
          </div>
        ) : (
          <p className="muted">还没有参考图，按文生图生成。</p>
        )}
      </section>

      <footer className={styles['wb3-card-footer']!}>
        <span>点任意一行打开弹窗编辑</span>
      </footer>
    </section>
  )
}
