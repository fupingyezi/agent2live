import React, { useEffect, useState } from 'react'
import { Button, Dialog, Field, InlineNotice, Textarea } from '@agent2live/design-system'

export interface FullPromptDialogProps {
  open: boolean
  value: string
  readOnly: boolean
  saving: boolean
  error: string | null
  onClose(): void
  onSave(value: string): void
}

export const FullPromptDialog: React.FC<FullPromptDialogProps> = ({
  open,
  value,
  readOnly,
  saving,
  error,
  onClose,
  onSave
}) => {
  const [text, setText] = useState(value)

  useEffect(() => {
    if (open) setText(value)
  }, [open, value])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose()
      }}
      title="完整提示词"
      description="高级编辑；保存后会与新版本一起提交。"
      busy={saving}
      footer={
        <>
          <Button variant="quiet" disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" disabled={readOnly || saving} onClick={() => onSave(text)}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <div className="wb3-dialog-stack">
        <Field label="提示词正文">
          <Textarea
            rows={14}
            maxLength={20_000}
            value={text}
            disabled={readOnly || saving}
            onValueChange={setText}
          />
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
