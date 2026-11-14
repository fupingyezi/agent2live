import React, { useId, useState } from 'react'
import { cx } from '../../internal/polymorphic'
import styles from '../../styles/primitives.module.css'

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
  const current = open === undefined ? innerOpen : open
  const triggerElement = React.cloneElement(trigger as React.ReactElement<Record<string, unknown>>, {
    'aria-expanded': current,
    'aria-haspopup': 'dialog',
    onClick: (event: React.MouseEvent) => {
      const original = (trigger.props as { onClick?: (event: React.MouseEvent) => void }).onClick
      original?.(event)
      if (open === undefined) setInnerOpen(!current)
      onOpenChange?.(!current)
    }
  })

  return (
    <span className={cx(styles.popoverAnchor, className)}>
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
