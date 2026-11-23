import React, { useEffect, useId, useRef, useState } from 'react'
import { cx } from '../../../internal/polymorphic'
import styles from './Popover.module.scss'

export interface PopoverProps {
  trigger: React.ReactElement
  label: string
  children: React.ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  placement?: 'bottom-start' | 'bottom-end'
  className?: string
}

export const Popover: React.FC<PopoverProps> = ({
  trigger,
  label,
  children,
  open,
  defaultOpen = false,
  onOpenChange,
  placement = 'bottom-start',
  className
}) => {
  const panelId = useId()
  const [innerOpen, setInnerOpen] = useState(defaultOpen)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const current = open === undefined ? innerOpen : open
  const close = (): void => {
    if (open === undefined) setInnerOpen(false)
    onOpenChange?.(false)
  }

  useEffect(() => {
    if (!current) return
    if (!restoreRef.current && document.activeElement instanceof HTMLElement) {
      restoreRef.current = document.activeElement
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (anchorRef.current?.contains(event.target as Node)) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      close()
      const target = restoreRef.current
      if (target?.isConnected) target.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      restoreRef.current = null
    }
  }, [current, open, onOpenChange])

  const triggerElement = React.cloneElement(trigger as React.ReactElement<Record<string, unknown>>, {
    'aria-expanded': current,
    'aria-haspopup': 'dialog',
    'aria-controls': panelId,
    onClick: (event: React.MouseEvent) => {
      const original = (trigger.props as { onClick?: (event: React.MouseEvent) => void }).onClick
      original?.(event)
      if (open === undefined) setInnerOpen(!current)
      onOpenChange?.(!current)
    }
  })

  return (
    <span ref={anchorRef} className={cx(styles.popoverAnchor, className)}>
      {triggerElement}
      {current ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={label}
          className={cx(styles.popover, styles[placement === 'bottom-end' ? 'popoverEnd' : 'popoverStart'])}
        >
          {children}
        </div>
      ) : null}
    </span>
  )
}
