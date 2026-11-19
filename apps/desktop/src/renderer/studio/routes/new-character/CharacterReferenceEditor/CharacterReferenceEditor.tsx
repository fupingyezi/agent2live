import React, { useEffect, useId, useState } from 'react'
import { Button, Dialog, IconButton } from '@agent2live/design-system'
import type { MaterialRole } from '@studio/api'
import { StudioPageTopbar } from '@studio/components'
import { strengthToWeight, type CharacterReferenceDraft, type ReferenceStrength } from '../reference-draft'
import styles from './CharacterReferenceEditor.module.scss'

const ROLE_OPTIONS: Array<{ value: MaterialRole; label: string }> = [
  { value: 'identity_reference', label: '身份' },
  { value: 'style_reference', label: '画风' },
  { value: 'outfit_reference', label: '服装' },
  { value: 'color_reference', label: '配色' },
  { value: 'pose_reference', label: '姿势' },
  { value: 'sketch', label: '草图' },
  { value: 'other', label: '其他' }
]

const ROLE_ROWS = [ROLE_OPTIONS.slice(0, 4), ROLE_OPTIONS.slice(4)]

const STRENGTH_OPTIONS: Array<{ value: ReferenceStrength; label: string }> = [
  { value: 'loose', label: '只参考' },
  { value: 'balanced', label: '主要参考' },
  { value: 'strict', label: '严格照做' }
]

const ROLE_LABELS: Record<MaterialRole, string> = {
  identity_reference: '身份',
  style_reference: '画风',
  outfit_reference: '服装',
  color_reference: '配色',
  background_reference: '背景',
  pose_reference: '姿势',
  sketch: '草图',
  texture: '质感',
  other: '其他'
}

const PHASE_TWO_TOOLS = ['裁切', '旋转', '提亮', '去背景', '还原'] as const

function useFileUrl(file: File): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const nextUrl = URL.createObjectURL(file)
    setUrl(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [file])

  return url
}

export interface CharacterReferenceEditorProps {
  reference: CharacterReferenceDraft
  onCancel: () => void
  onComplete: (reference: CharacterReferenceDraft) => void
}

export const CharacterReferenceEditor: React.FC<CharacterReferenceEditorProps> = ({
  reference,
  onCancel,
  onComplete
}) => {
  const [draft, setDraft] = useState(reference)
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)
  const noteId = useId()
  const url = useFileUrl(draft.file)

  useEffect(() => {
    setDraft(reference)
    setDimensions(null)
  }, [reference])

  const complete = (): void => {
    onComplete(draft)
  }

  return (
    <Dialog
      open
      className={styles['reference-editor-dialog']!}
      title="参考图"
      description="编辑参考图用途、参考强度和备注。"
      showClose={false}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      footer={
        <div className={styles['reference-editor-footer']!}>
          <div className={styles['reference-editor-footer-actions']!}>
            <Button
              type="button"
              className={styles['reference-editor-cancel-action']!}
              variant="secondary"
              onClick={onCancel}
            >
              取消
            </Button>
            <Button type="button" className={styles['reference-editor-complete-action']!} onClick={complete}>
              完成
            </Button>
          </div>
        </div>
      }
    >
      <div className={styles['reference-editor-content']!}>
        <StudioPageTopbar
          breadcrumb="参考图"
          tone="editor"
          status={<span className={styles['reference-editor-role-tag']!}>{ROLE_LABELS[draft.role]}</span>}
          actions={
            <IconButton type="button" label="关闭参考图编辑" variant="quiet" onClick={onCancel}>
              ×
            </IconButton>
          }
        />

        <div className={styles['reference-editor-main']!}>
          <section className={styles['reference-editor-stage']!} aria-label="参考图预览">
            <article className={styles['reference-editor-preview-card']!}>
              <header>
                <span>{dimensions ? `${dimensions.width} × ${dimensions.height}` : '读取尺寸中…'}</span>
                <span data-testid="reference-editor-source">本地原图</span>
              </header>
              <div className={styles['reference-editor-image']!}>
                {url ? (
                  <img
                    src={url}
                    alt={draft.file.name}
                    onLoad={(event) => {
                      setDimensions({
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight
                      })
                    }}
                  />
                ) : (
                  <span aria-hidden="true">…</span>
                )}
              </div>
              <footer>
                <span>原图未裁切</span>
                <div className={styles['reference-editor-tools']!} aria-label="图片工具">
                  {PHASE_TWO_TOOLS.map((tool) => (
                    <button key={tool} type="button" disabled title={`${tool}将在 Phase 2 开放`}>
                      {tool}
                    </button>
                  ))}
                </div>
              </footer>
            </article>
          </section>

          <aside className={styles['reference-editor-settings']!}>
            <h2>参考图设置</h2>

            <section className={styles['reference-editor-group']!}>
              <h3>用途</h3>
              <div className={styles['reference-editor-chip-rows']!} role="group" aria-label="参考图用途">
                {ROLE_ROWS.map((row, rowIndex) => (
                  <div key={rowIndex} className={styles['reference-editor-chip-row']!}>
                    {row.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={draft.role === option.value}
                        onClick={() => setDraft((current) => ({ ...current, role: option.value }))}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </section>

            <section className={styles['reference-editor-group']!}>
              <h3>参考强度</h3>
              <div className={styles['reference-editor-chip-row']!} role="group" aria-label="参考强度">
                {STRENGTH_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={draft.strength === option.value}
                    title={`权重 ${strengthToWeight(option.value)}`}
                    onClick={() => setDraft((current) => ({ ...current, strength: option.value }))}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>

            <section className={`${styles['reference-editor-group']!} ${styles['reference-editor-note']!}`}>
              <label htmlFor={noteId}>备注</label>
              <textarea
                id={noteId}
                value={draft.note}
                maxLength={1000}
                placeholder="例如：脸型照这张，发型不用管"
                onChange={(event) => {
                  const note = event.currentTarget.value
                  setDraft((current) => ({ ...current, note }))
                }}
              />
            </section>
          </aside>
        </div>
      </div>
    </Dialog>
  )
}
