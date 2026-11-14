import React from 'react'
import type { MaterialRole, PromptInputSubmissionDto } from '../../api/types'
import { useAssetUrl } from '../../hooks/useAssetUrl'
import { CountBadge, EmptyState, SectionHeader, StatusPill } from '@agent2live/design-system'

const ROLE_LABELS: Record<MaterialRole, string> = {
  identity_reference: '身份参考',
  style_reference: '风格参考',
  outfit_reference: '服装参考',
  color_reference: '配色参考',
  background_reference: '背景参考',
  pose_reference: '姿态参考',
  sketch: '草图',
  texture: '材质',
  other: '其他'
}

interface MaterialItemProps {
  assetId: string
  role: MaterialRole
  note: string
  sortOrder: number
  weight: number
  locked: boolean
}

const MaterialItem: React.FC<MaterialItemProps> = ({ assetId, role, note, sortOrder, weight, locked }) => {
  const { url, isLoading, error } = useAssetUrl(assetId)
  const label = ROLE_LABELS[role]
  return (
    <figure className="material-item" data-testid="material-item" data-asset-id={assetId} data-role={role}>
      <div className="material-image">
        {url ? (
          <img src={url} alt={`${label}预览`} />
        ) : (
          <span>{isLoading ? '加载中…' : error ? '无法加载' : '—'}</span>
        )}
        {locked ? <StatusPill label="已锁定" tone="warning" /> : null}
      </div>
      <figcaption>
        <strong>{label}</strong>
        <span>{note || `素材 ${sortOrder + 1}`}</span>
        <span>权重 {weight.toFixed(1)}</span>
      </figcaption>
    </figure>
  )
}

export interface MaterialTrayProps {
  submission: PromptInputSubmissionDto | null
}

export const MaterialTray: React.FC<MaterialTrayProps> = ({ submission }) => {
  return (
    <section className="workbench-panel material-tray" data-testid="material-tray">
      <SectionHeader
        title="参考资产"
        description="素材"
        {...(submission ? { actions: <CountBadge value={submission.materials.length} /> } : {})}
      />
      {!submission || submission.materials.length === 0 ? (
        <EmptyState title="还没有素材" description="在下方“素材与要求”中上传身份、服装或风格参考。" />
      ) : (
        <>
          <div className="material-grid">
            {submission.materials.map((material) => (
              <MaterialItem
                key={material.id}
                assetId={material.assetId}
                role={material.role}
                note={material.note}
                sortOrder={material.sortOrder}
                weight={material.weight}
                locked={material.locked}
              />
            ))}
          </div>
          {submission.globalNotes ? (
            <div className="global-notes">
              <p className="info-label">整体说明</p>
              <p>{submission.globalNotes}</p>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
