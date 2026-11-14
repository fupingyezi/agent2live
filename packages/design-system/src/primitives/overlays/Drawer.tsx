import React, { useEffect, useId, useRef } from 'react'
import { focusFirst, trapTab } from '../../internal/focus'
import { cx } from '../../internal/polymorphic'
import { renderPortal } from '../../internal/portal'
import styles from '../../styles/primitives.module.css'
import { IconButton } from '../actions/IconButton'

export interface DrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  side?: 'left' | 'right' | 'bottom'
  busy?: boolean
  closeLabel?: string
}

export const Drawer: React.FC<DrawerProps> = ({
  open,
  onOpenChange,
  title,
  children,
  footer,
  side = 'right',
  busy = false,
  closeLabel = '关闭'
}) => {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    focusFirst(panelRef.current)
    return () => restoreRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onOpenChange(false)
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
        className={cx(styles.drawer, styles[`drawer${side[0]!.toUpperCase()}${side.slice(1)}`])}
        data-state={busy ? 'busy' : 'open'}
      >
        <header className={styles.dialogHeader}>
          <h2 id={titleId} className={styles.dialogTitle}>
            {title}
          </h2>
          <IconButton label={closeLabel} variant="quiet" onClick={() => onOpenChange(false)} disabled={busy}>
            ×
          </IconButton>
        </header>
        <div className={styles.dialogBody}>{children}</div>
        {footer ? <footer className={styles.dialogFooter}>{footer}</footer> : null}
      </div>
    </div>
  )
}
