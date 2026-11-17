import React from 'react'
import type { ArtProjectDto, PromptVersionDto } from '@studio/api'
import { useAssetUrl } from '@studio/hooks'
import { shortId } from '@studio/format'
import { StatusPill } from '@agent2live/design-system'

interface ReferenceThumbProps {
  assetId: string
  label: string
}

const ReferenceThumb: React.FC<ReferenceThumbProps> = ({ assetId, label }) => {
  const { url, isLoading } = useAssetUrl(assetId)
  return (
    <div className="reference-thumb" title={assetId}>
      {url ? (
        <img src={url} alt={label} />
      ) : (
        <span className="reference-placeholder">{isLoading ? '…' : '—'}</span>
      )}
      <span>{label}</span>
    </div>
  )
}

export interface ReferenceChainBarProps {
  project: ArtProjectDto
  activePromptVersion: PromptVersionDto | null
}

export const ReferenceChainBar: React.FC<ReferenceChainBarProps> = ({ project, activePromptVersion }) => {
  const firstReference = activePromptVersion?.references[0] ?? null
  return (
    <section className="reference-chain" data-testid="reference-chain" aria-label="参考链">
      <div className="reference-chain-title">
        <span className="eyebrow">参考链</span>
        <strong>下一次生成的参考顺序</strong>
      </div>
      <div className="reference-chain-flow">
        {firstReference ? (
          <>
            <ReferenceThumb
              assetId={firstReference.assetId}
              label={`提示词 v${activePromptVersion!.versionNumber} 第 1 张`}
            />
            <span className="chain-arrow" aria-hidden="true">
              →
            </span>
          </>
        ) : (
          <div className="reference-empty">
            <span>当前提示词没有参考图</span>
            <small>生成将按文生图处理</small>
          </div>
        )}
        <div className="reference-prompt">
          {activePromptVersion ? (
            <>
              <StatusPill label={`提示词 v${activePromptVersion.versionNumber}`} tone="accent" />
              <code title={activePromptVersion.id}>{shortId(activePromptVersion.id)}</code>
            </>
          ) : (
            <span className="muted">尚无已提交提示词版本</span>
          )}
        </div>
        {project.forkedFrom ? (
          <StatusPill
            label={`分支：${project.forkedFrom.branchLabel}`}
            tone={project.forkedFrom.status === 'detached' ? 'warning' : 'neutral'}
          />
        ) : null}
      </div>
    </section>
  )
}
