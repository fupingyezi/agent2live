import React, { useId, useState } from 'react'
import { cx } from '../../internal/polymorphic'
import styles from '../../styles/primitives.module.css'

export interface TooltipProps {
  label: React.ReactNode
  children: React.ReactNode
  className?: string
}

export const Tooltip: React.FC<TooltipProps> = ({ label, children, className }) => {
  const id = useId()
  const [open, setOpen] = useState(false)
  return (
    <span
      className={cx(styles.tooltipWrap, className)}
      aria-describedby={open ? id : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open ? (
        <span id={id} role="tooltip" className={styles.tooltip}>
          {label}
        </span>
      ) : null}
    </span>
  )
}
