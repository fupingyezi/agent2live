import React from 'react'
import { Lock } from 'lucide-react'
import type { PromptBlock } from '@studio/api'
import type { PromptBlockGroup } from '../../../prompt-diagnostics'
import styles from './PromptBlockGroupView.module.scss'

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
    <section className={styles['wb3-block-group']!} data-testid="wb3-prompt-group" data-group={group.id}>
      <div className={styles['wb3-block-group-head']!}>
        <span className={styles['wb3-block-group-title']!}>{group.label}</span>
        {group.negative ? <span className={styles['wb3-block-group-note']!}>不生成这些</span> : null}
        <button
          type="button"
          className={styles['wb3-link-button']!}
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          {collapsed ? '展开' : '收起'}
        </button>
      </div>
      {collapsed
        ? null
        : group.blocks.map((block) => {
            const weight = weightBadge(block)
            return (
              <button
                key={block.id}
                type="button"
                className={[
                  styles['wb3-block-row']!,
                  shadowed.has(block.id) ? styles['is-shadowed']! : '',
                  dropped.has(block.id) ? styles['is-dropped']! : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-testid="wb3-prompt-block-row"
                data-block-id={block.id}
                data-category={block.category}
                disabled={busy}
                onClick={() => onOpenBlock(block.id, group.negative)}
              >
                <span
                  className={styles['wb3-block-dot']!}
                  data-category={block.category}
                  aria-hidden="true"
                />
                <span className={styles['wb3-block-name']!}>{block.label}</span>
                <span className={styles['wb3-block-text']!}>{block.text}</span>
                <span className={styles['wb3-block-badges']!}>
                  {weight ? <span className={styles['wb3-badge']!}>{weight}</span> : null}
                  {block.locked || lockAll ? (
                    <span className={styles['wb3-badge']!}>
                      <Lock size={12} aria-label="已锁定" />
                    </span>
                  ) : null}
                </span>
              </button>
            )
          })}
    </section>
  )
}
