import React from 'react'
import type { PromptRequirement, PromptSpecV2 } from '@studio/api'
import { useWorkbenchStore } from '../store'
import { uncoveredRequirementIds } from '../prompt-helpers'
import { PromptBlockCard } from './PromptBlockCard'
import { Button, CountBadge, EmptyState, InlineNotice, SectionHeader } from '@agent2live/design-system'

export interface PromptBlockListProps {
  spec: PromptSpecV2
  requirements: PromptRequirement[]
  disabled: boolean
}

export const PromptBlockList: React.FC<PromptBlockListProps> = ({ spec, requirements, disabled }) => {
  const store = useWorkbenchStore()
  const uncovered = uncoveredRequirementIds(spec)
  const uncoveredRequirements = requirements.filter((item) => uncovered.includes(item.id))
  const total = spec.blocks.length + spec.negativeBlocks.length
  const usableMaterials = spec.materialRefs

  return (
    <section className="workbench-panel prompt-blocks" data-testid="prompt-block-list">
      <SectionHeader title="提示词编辑" description="逐块核对描述" actions={<CountBadge value={total} />} />

      {uncoveredRequirements.length > 0 ? (
        <InlineNotice tone="warning">
          <strong>必须/避免要求尚未被块覆盖</strong>
          <ul>
            {uncoveredRequirements.map((requirement) => (
              <li key={requirement.id}>
                {requirement.strength === 'must' ? '必须' : '避免'}：{requirement.text}
              </li>
            ))}
          </ul>
        </InlineNotice>
      ) : null}

      {total === 0 ? (
        <EmptyState
          title="还没有提示词块"
          description="从素材反推，或手工添加第一块。提交版本前至少要有一个正向块。"
        />
      ) : null}

      <div className="block-section">
        <SectionHeader
          title="正向块"
          actions={
            <Button
              type="button"
              variant="quiet"
              size="sm"
              disabled={disabled || spec.lockAll}
              onClick={() => store.addBlock(false)}
            >
              + 添加块
            </Button>
          }
        />
        {spec.blocks.map((block) => (
          <PromptBlockCard
            key={block.id}
            block={block}
            negative={false}
            requirements={requirements}
            materials={usableMaterials}
            disabled={disabled}
          />
        ))}
      </div>

      <div className="block-section negative-section">
        <SectionHeader
          title="负面块"
          actions={
            <Button
              type="button"
              variant="quiet"
              size="sm"
              disabled={disabled || spec.lockAll}
              onClick={() => store.addBlock(true)}
            >
              + 添加负面块
            </Button>
          }
        />
        {spec.negativeBlocks.length === 0 ? (
          <p className="muted">没有负面块；avoid 要求需要放在负面块中才算覆盖。</p>
        ) : null}
        {spec.negativeBlocks.map((block) => (
          <PromptBlockCard
            key={block.id}
            block={block}
            negative
            requirements={requirements}
            materials={usableMaterials}
            disabled={disabled}
          />
        ))}
      </div>
    </section>
  )
}
