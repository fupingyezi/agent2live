import React from 'react'
import { cx } from '../../internal/polymorphic'
import styles from '../../styles/primitives.module.css'

export type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export interface StatusPillProps {
  label: React.ReactNode
  tone?: StatusTone
  className?: string
}

export const StatusPill: React.FC<StatusPillProps> = ({ label, tone = 'neutral', className }) => {
  return (
    <span
      className={cx(styles.statusPill, styles[`tone${tone[0]!.toUpperCase()}${tone.slice(1)}`], className)}
      data-state={tone}
    >
      {label}
    </span>
  )
}
