import React from 'react'
import type { ArtProjectDto, ArtVersionDto, PromptVersionSummaryDto } from '@studio/api'
import { useAssetUrl } from '@studio/hooks'
import { formatDateTime, shortId } from '@studio/format'
import { Button, CountBadge, EmptyState, SectionHeader, StatusPill } from '@agent2live/design-system'
import type { ForkSource } from './ForkDialog'

interface ArtThumbProps {
  assetId: string
}

const ArtThumb: React.FC<ArtThumbProps> = ({ assetId }) => {
  const { url, isLoading } = useAssetUrl(assetId)
  return (
    <div className="version-thumb">
      {url ? <img src={url} alt="美术版本预览" /> : <span>{isLoading ? '…' : '—'}</span>}
    </div>
  )
}

export interface VersionGraphProps {
  project: ArtProjectDto
  promptVersions: PromptVersionSummaryDto[]
  artVersions: ArtVersionDto[]
  onFork: (source: ForkSource) => void
}

export const VersionGraph: React.FC<VersionGraphProps> = ({
  project,
  promptVersions,
  artVersions,
  onFork
}) => {
  return (
    <section className="version-graph" data-testid="version-graph">
      <div className="version-column">
        <SectionHeader
          title="提示词版本"
          description="不可变历史"
          actions={<CountBadge value={promptVersions.length} />}
        />
        {promptVersions.length === 0 ? (
          <EmptyState title="还没有提示词版本" description="保存当前修改后会出现在这里。" />
        ) : (
          <ol className="version-list">
            {promptVersions.map((version) => {
              const active = version.id === project.activePromptVersionId
              return (
                <li className={`version-row${active ? ' active-version' : ''}`} key={version.id}>
                  <div className="version-row-main">
                    <strong>v{version.versionNumber}</strong>
                    <code title={version.id}>{shortId(version.contentHash, 10)}</code>
                    {active ? <StatusPill label="当前" tone="accent" /> : null}
                  </div>
                  <div className="version-row-meta">
                    {formatDateTime(version.createdAt)}
                    {version.parentVersionId ? ` · 父 ${shortId(version.parentVersionId, 8)}` : ' · 根'}
                  </div>
                  <Button
                    type="button"
                    variant="quiet"
                    size="sm"
                    onClick={() =>
                      onFork({
                        kind: 'prompt_version',
                        versionId: version.id,
                        versionLabel: `提示词 v${version.versionNumber}`
                      })
                    }
                  >
                    从此版本分支
                  </Button>
                </li>
              )
            })}
          </ol>
        )}
      </div>

      <div className="version-column">
        <SectionHeader
          title="美术版本"
          description="立绘链"
          actions={<CountBadge value={artVersions.length} />}
        />
        {artVersions.length === 0 ? (
          <EmptyState title="还没有美术版本" description="生成候选被接受，或手工上传后出现。" />
        ) : (
          <ol className="version-list">
            {artVersions.map((version) => {
              const active = version.id === project.activeVersionId
              return (
                <li className={`version-row art-row${active ? ' active-version' : ''}`} key={version.id}>
                  <ArtThumb assetId={version.artworkAssetId} />
                  <div className="version-row-body">
                    <div className="version-row-main">
                      <strong>v{version.versionNumber}</strong>
                      {active ? <StatusPill label="当前立绘" tone="accent" /> : null}
                    </div>
                    <div className="version-row-meta">
                      提示词 {shortId(version.promptVersionId, 8)} · {formatDateTime(version.createdAt)}
                    </div>
                    <Button
                      type="button"
                      variant="quiet"
                      size="sm"
                      onClick={() =>
                        onFork({
                          kind: 'art_version',
                          versionId: version.id,
                          versionLabel: `美术 v${version.versionNumber}`
                        })
                      }
                    >
                      从此版本分支
                    </Button>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </section>
  )
}
