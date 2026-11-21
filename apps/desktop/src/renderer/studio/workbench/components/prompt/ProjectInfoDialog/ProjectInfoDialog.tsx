import React from 'react'
import type { ArtProjectDto, ArtVersionDto, PromptVersionDto } from '@studio/api'
import { useAssetUrl } from '@studio/hooks'
import { formatDateTime, formatStage, stageTone } from '@studio/format'
import { Button, Dialog, StatusPill } from '@agent2live/design-system'
import { ART_SOURCE_LABELS } from '../../../prompt-labels'
import { ForkOriginBar } from '../../ForkOriginBar'
import { ReferenceChainBar } from '../../ReferenceChainBar'
import styles from './ProjectInfoDialog.module.scss'

interface ArtThumbProps {
  assetId: string
  label: string
}

const ArtThumb: React.FC<ArtThumbProps> = ({ assetId, label }) => {
  const { url, isLoading } = useAssetUrl(assetId)
  return (
    <div className={styles['thumb']!}>
      {url ? <img src={url} alt={label} /> : <span>{isLoading ? '…' : '—'}</span>}
    </div>
  )
}

interface VersionRowProps {
  label: string
  value: string
  detail: string
}

const VersionRow: React.FC<VersionRowProps> = ({ label, value, detail }) => (
  <div className={styles['version-row']!}>
    <span className={styles['version-label']!}>{label}</span>
    <span className={styles['version-value']!}>{value}</span>
    <span className={styles['version-detail']!}>{detail}</span>
  </div>
)

export interface ProjectInfoDialogProps {
  open: boolean
  project: ArtProjectDto
  characterTitle: string
  characterSummary: string | null
  promptVersion: PromptVersionDto | null
  artVersions: ArtVersionDto[]
  activePromptVersion: PromptVersionDto | null
  onClose(): void
}

export const ProjectInfoDialog: React.FC<ProjectInfoDialogProps> = ({
  open,
  project,
  characterTitle,
  characterSummary,
  promptVersion,
  artVersions,
  activePromptVersion,
  onClose
}) => {
  const activeArtVersion =
    artVersions.find((version) => version.id === project.activeVersionId) ?? artVersions[0] ?? null
  const blockCount = promptVersion
    ? promptVersion.state.blocks.length + promptVersion.state.negativeBlocks.length
    : 0
  const referenceCount = promptVersion?.state.materialRefs.length ?? 0

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="项目信息"
      className={styles['project-info-dialog']!}
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <div className={styles['content']!}>
        <div className={styles['character']!}>
          {activeArtVersion ? (
            <ArtThumb assetId={activeArtVersion.artworkAssetId} label={`${characterTitle} 当前立绘`} />
          ) : (
            <div className={styles['thumb']!} data-empty="true">
              <span>—</span>
            </div>
          )}
          <div className={styles['character-copy']!}>
            <strong>{characterTitle}</strong>
            {characterSummary ? <span>{characterSummary}</span> : null}
          </div>
          <StatusPill label={formatStage(project.stage)} tone={stageTone(project.stage)} />
        </div>

        <div className={styles['divider']!} />

        <section className={styles['section']!}>
          <header className={styles['section-head']!}>
            <h3>四套版本</h3>
            <span>各自从第 1 版排号</span>
          </header>
          <div className={styles['version-table']!}>
            <VersionRow
              label="提示词"
              value={promptVersion ? `第 ${promptVersion.versionNumber} 版` : '未生成'}
              detail={promptVersion ? `${blockCount} 块` : '还没有提示词版本'}
            />
            <div className={styles['divider']!} />
            <VersionRow
              label="立绘"
              value={activeArtVersion ? `第 ${activeArtVersion.versionNumber} 版` : '未生成'}
              detail={activeArtVersion ? ART_SOURCE_LABELS[activeArtVersion.sourceKind] : '等提示词生成'}
            />
            <div className={styles['divider']!} />
            <VersionRow label="分层" value="未生成" detail="等立绘定下来" />
            <div className={styles['divider']!} />
            <VersionRow label="绑定" value="未生成" detail="等分层确认后开始" />
          </div>
        </section>

        <div className={styles['divider']!} />

        <div className={styles['stats']!}>
          <div>
            <span>参考图</span>
            <strong>{`${referenceCount} / 14`}</strong>
          </div>
          <div>
            <span>创建</span>
            <strong>{formatDateTime(project.createdAt)}</strong>
          </div>
          <div>
            <span>近期改动</span>
            <strong>{formatDateTime(project.updatedAt)}</strong>
          </div>
        </div>

        <div className={styles['divider']!} />

        <div className={styles['supplement']!}>
          <ReferenceChainBar project={project} activePromptVersion={activePromptVersion} />
          <ForkOriginBar project={project} />
        </div>
      </div>
    </Dialog>
  )
}
