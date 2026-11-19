import React, { useEffect, useId, useRef } from 'react'
import { focusFirst, trapTab } from '../../../internal/focus'
import { cx } from '../../../internal/polymorphic'
import { renderPortal } from '../../../internal/portal'
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
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    focusFirst(panelRef.current)
    return () => {
      restoreRef.current?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault()
        onOpenChange(false)
        return
      }
      trapTab(event, panelRef.current)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, busy, onOpenChange])

  if (!open) return null

  return renderPortal(
    <div
      className={styles.dialogBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onOpenChange(false)
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cx(styles.dialog, className)}
        data-state={busy ? 'busy' : 'open'}
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
            <IconButton
              label={closeLabel}
              variant="quiet"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              ×
            </IconButton>
          ) : null}
        </header>
        {children ? <div className={styles.dialogBody}>{children}</div> : null}
        {footer ? <footer className={styles.dialogFooter}>{footer}</footer> : null}
      </div>
    </div>
  )
}
