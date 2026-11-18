import React, { useEffect, useState } from 'react'
import { Button, Dialog, Field, InlineNotice, TextField } from '@agent2live/design-system'

export interface RenameDialogProps {
  open: boolean
  currentTitle: string
  saving: boolean
  error: string | null
  onClose(): void
  onSave(title: string): void
}

export const RenameDialog: React.FC<RenameDialogProps> = ({
  open,
  currentTitle,
  saving,
  error,
  onClose,
  onSave
}) => {
  const [title, setTitle] = useState(currentTitle)

  useEffect(() => {
    if (open) setTitle(currentTitle)
  }, [open, currentTitle])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose()
      }}
      title="改名"
      busy={saving}
      footer={
        <>
          <Button variant="quiet" disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={saving || title.trim().length === 0}
            onClick={() => onSave(title.trim())}
          >
            {saving ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <div className="wb3-dialog-stack">
        <Field label="角色名称">
          <TextField value={title} maxLength={100} disabled={saving} onValueChange={setTitle} />
        </Field>
        {error ? (
          <div role="alert">
            <InlineNotice tone="danger">{error}</InlineNotice>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
