import React from 'react'
import { AsyncButton } from '../actions/AsyncButton'
import { Button } from '../actions/Button'
import { Dialog } from './Dialog'

export interface ConfirmDialogProps {
  open: boolean
  title: React.ReactNode
  children?: React.ReactNode
  description?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  busy?: boolean
  destructive?: boolean
  confirmDisabled?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  children,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  busy = false,
  destructive = false,
  confirmDisabled = false,
  onConfirm,
  onCancel
}) => {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel()
      }}
      title={title}
      description={description}
      busy={busy}
      showClose={false}
      footer={
        <>
          <Button variant="quiet" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <AsyncButton
            variant={destructive ? 'danger' : 'primary'}
            busy={busy}
            busyLabel="处理中…"
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AsyncButton>
        </>
      }
    >
      {children}
    </Dialog>
  )
}
