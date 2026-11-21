import React, { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import { focusFirst, trapTab } from '../../../internal/focus'
import { cx } from '../../../internal/polymorphic'
import { renderPortal } from '../../../internal/portal'
import styles from './Drawer.module.scss'
import { IconButton } from '../../actions/IconButton'

export interface DrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  side?: 'left' | 'right' | 'bottom'
  busy?: boolean
  closeLabel?: string
  modal?: boolean
  className?: string
}

export const Drawer: React.FC<DrawerProps> = ({
  open,
  onOpenChange,
  title,
  children,
  footer,
  side = 'right',
  busy = false,
  closeLabel = '关闭',
  modal = true,
  className
}) => {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open || !modal) return
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    focusFirst(panelRef.current)
    return () => restoreRef.current?.focus()
  }, [open, modal])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onOpenChange(false)
      if (modal) trapTab(event, panelRef.current)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, busy, modal, onOpenChange])

  if (!open) return null

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal={modal}
      aria-labelledby={titleId}
      className={cx(
        styles.drawer,
        styles[`drawer${side[0]!.toUpperCase()}${side.slice(1)}`],
        !modal ? styles.drawerNonModal : undefined,
        className
      )}
      data-state={busy ? 'busy' : 'open'}
    >
      <header className={styles.dialogHeader}>
        <h2 id={titleId} className={styles.dialogTitle}>
          {title}
        </h2>
        <IconButton label={closeLabel} variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
          <X size={16} aria-hidden="true" />
        </IconButton>
      </header>
      <div className={styles.dialogBody}>{children}</div>
      {footer ? <footer className={styles.dialogFooter}>{footer}</footer> : null}
    </div>
  )

  if (!modal) return renderPortal(panel)

  return renderPortal(
    <div
      className={styles.dialogBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onOpenChange(false)
      }}
    >
      {panel}
    </div>
  )
}
