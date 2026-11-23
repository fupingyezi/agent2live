import React, { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import { focusFirst } from '../../../internal/focus'
import { cx } from '../../../internal/polymorphic'
import styles from './Dialog.module.scss'
import { IconButton } from '../../actions/IconButton'

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  busy?: boolean
  closeLabel?: string
  showClose?: boolean
  className?: string
}

export const Dialog: React.FC<DialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  busy = false,
  closeLabel = '关闭',
  showClose = true,
  className
}) => {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const onOpenChangeRef = useRef(onOpenChange)
  const busyRef = useRef(busy)
  onOpenChangeRef.current = onOpenChange
  busyRef.current = busy

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (typeof dialog.showModal === 'function') {
      dialog.showModal()
    } else {
      dialog.setAttribute('open', '')
    }
    focusFirst(dialog)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      // 原生 select 的 picker 也在 top layer；Esc 应先关闭 picker，而不是整个弹窗。
      try {
        if (document.querySelector('select:open')) return
      } catch {
        // jsdom 等环境可能不支持 :open 选择器。
      }
      event.preventDefault()
      if (!busyRef.current) onOpenChangeRef.current(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (typeof dialog.close === 'function' && dialog.open) {
        dialog.close()
      } else {
        dialog.removeAttribute('open')
      }
      previous?.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={cx(styles.dialog, className)}
      data-state={busy ? 'busy' : 'open'}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onOpenChange(false)
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onOpenChange(false)
      }}
    >
      <header className={styles.dialogHeader}>
        <div>
          <h2 id={titleId} className={styles.dialogTitle}>
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className={styles.dialogDescription}>
              {description}
            </p>
          ) : null}
        </div>
        {showClose ? (
          <IconButton label={closeLabel} variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            <X size={16} aria-hidden="true" />
          </IconButton>
        ) : null}
      </header>
      {children ? <div className={styles.dialogBody}>{children}</div> : null}
      {footer ? <footer className={styles.dialogFooter}>{footer}</footer> : null}
    </dialog>
  )
}
