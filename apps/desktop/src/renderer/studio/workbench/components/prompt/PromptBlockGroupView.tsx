import React from 'react'
import type { PromptBlock } from '@studio/api'
import type { PromptBlockGroup } from '../../prompt-diagnostics'
import { isPendingBlock } from '../../prompt-diagnostics'
import { effectiveBlockStrength } from '@agent2live/contracts/prompt'

export interface PromptBlockGroupViewProps {
  group: PromptBlockGroup
  collapsed: boolean
  shadowed: Set<string>
  dropped: Set<string>
  lockAll: boolean
  busy: boolean
  onToggle(): void
  onOpenBlock(blockId: string, negative: boolean): void
}

function weightBadge(block: PromptBlock): string | null {
  return block.weight === 1 ? null : `×${block.weight.toFixed(1)}`
}

function aiBadge(block: PromptBlock): string | null {
  if (block.source !== 'vision-model' && block.source !== 'ai-suggestion') return null
  return `AI ${Math.round(block.confidence * 100)}%`
}

export const PromptBlockGroupView: React.FC<PromptBlockGroupViewProps> = ({
  group,
  collapsed,
  shadowed,
  dropped,
  lockAll,
  busy,
  onToggle,
  onOpenBlock
}) => {
  return (
    <section className="wb3-block-group" data-testid="wb3-prompt-group" data-group={group.id}>
      <div className="wb3-block-group-head">
        <span className="wb3-block-group-title">{group.label}</span>
        <span className="wb3-block-group-count">{group.blocks.length} 块</span>
        {group.negative ? <span className="wb3-block-group-note">不生成这些</span> : null}
        <button type="button" className="wb3-link-button" aria-expanded={!collapsed} onClick={onToggle}>
          {collapsed ? '展开' : '收起'}
        </button>
      </div>
      {collapsed
        ? null
        : group.blocks.map((block) => {
            const strength = effectiveBlockStrength(block, group.negative)
            const pending = !group.negative && isPendingBlock(block)
            return (
              <button
                key={block.id}
                type="button"
                className={[
                  'wb3-block-row',
                  shadowed.has(block.id) ? 'is-shadowed' : '',
                  dropped.has(block.id) ? 'is-dropped' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-testid="wb3-prompt-block-row"
                data-block-id={block.id}
                data-category={block.category}
                disabled={busy}
                onClick={() => onOpenBlock(block.id, group.negative)}
              >
                <span className="wb3-block-dot" data-category={block.category} aria-hidden="true" />
                <span className="wb3-block-name">{block.label}</span>
                <span className="wb3-block-text">{block.text}</span>
                <span className="wb3-block-badges">
                  {pending ? <span className="wb3-badge wb3-badge-pending">待补</span> : null}
                  {shadowed.has(block.id) ? (
                    <span className="wb3-badge wb3-badge-warning">被覆盖</span>
                  ) : null}
                  {dropped.has(block.id) ? <span className="wb3-badge wb3-badge-danger">没落到</span> : null}
                  {weightBadge(block) ? <span className="wb3-badge">{weightBadge(block)}</span> : null}
                  {aiBadge(block) ? (
                    <span className="wb3-badge wb3-badge-accent">{aiBadge(block)}</span>
                  ) : null}
                  {group.negative || strength === 'avoid' ? (
                    <span className="wb3-badge wb3-badge-warning">避免</span>
                  ) : null}
                  {block.locked || lockAll ? <span className="wb3-badge">锁</span> : null}
                </span>
              </button>
            )
          })}
    </section>
  )
}
