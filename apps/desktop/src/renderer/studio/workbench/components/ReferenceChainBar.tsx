import React from 'react'
import type { ArtProjectDto, ArtVersionDto, PromptVersionSummaryDto } from '@studio/api'
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
  artVersions: ArtVersionDto[]
  activePromptVersion: PromptVersionSummaryDto | null
}

export const ReferenceChainBar: React.FC<ReferenceChainBarProps> = ({
  project,
  artVersions,
  activePromptVersion
}) => {
  const active = artVersions.find((version) => version.id === project.activeVersionId) ?? null
  const primary = active?.references.find((reference) => reference.isPrimary) ?? null
  return (
    <section className="reference-chain" data-testid="reference-chain" aria-label="参考链">
      <div className="reference-chain-title">
        <span className="eyebrow">参考链</span>
        <strong>下一次生成的主参考</strong>
      </div>
      <div className="reference-chain-flow">
        {active && primary ? (
          <>
            <ReferenceThumb assetId={primary.assetId} label={`美术 v${active.versionNumber}`} />
            <span className="chain-arrow" aria-hidden="true">
              →
            </span>
          </>
        ) : (
          <div className="reference-empty">
            <span>尚无 active ArtVersion</span>
            <small>首轮生成将只使用素材</small>
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
