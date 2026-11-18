import React from 'react'
import type { PromptSpecV2 } from '@studio/api'
import { Button, Dialog, InlineNotice } from '@agent2live/design-system'
import { PromptReferenceEditor } from '../PromptReferenceEditor'

export interface ReferenceGalleryDialogProps {
  open: boolean
  spec: PromptSpecV2 | null
  readOnly: boolean
  onClose(): void
  onChange(references: PromptSpecV2['materialRefs']): void
  onOpenMaterials(): void
  onOpenReverse(): void
}

export const ReferenceGalleryDialog: React.FC<ReferenceGalleryDialogProps> = ({
  open,
  spec,
  readOnly,
  onClose,
  onChange,
  onOpenMaterials,
  onOpenReverse
}) => {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="参考图"
      description="数组顺序就是生成顺序；最多 14 张。"
      className="wb3-reference-dialog"
      footer={
        <>
          <Button variant="quiet" disabled={readOnly} onClick={onOpenMaterials}>
            素材与要求
          </Button>
          <Button variant="quiet" disabled={readOnly} onClick={onOpenReverse}>
            读参考图反推
          </Button>
          <span className="wb3-dialog-spacer" />
          <Button variant="primary" onClick={onClose}>
            完成
          </Button>
        </>
      }
    >
      {spec ? (
        <PromptReferenceEditor references={spec.materialRefs} disabled={readOnly} onChange={onChange} />
      ) : (
        <InlineNotice tone="info">正在载入参考图…</InlineNotice>
      )}
    </Dialog>
  )
}
