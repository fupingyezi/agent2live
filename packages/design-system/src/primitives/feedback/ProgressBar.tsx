import React from 'react'
import { cx } from '../../internal/polymorphic'
import styles from '../../styles/primitives.module.css'

export interface ProgressBarProps {
  label: string
  value?: number
  tone?: 'running' | 'success' | 'error'
  className?: string
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ label, value, tone = 'running', className }) => {
  const indeterminate = value === undefined
  const clamped = indeterminate ? 0 : Math.min(100, Math.max(0, value))
  const toneClass =
    tone === 'running' ? undefined : styles[`progress${tone[0]!.toUpperCase()}${tone.slice(1)}`]

  return (
    <div
      className={cx(styles.progress, toneClass, className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : clamped}
      data-state={indeterminate ? 'indeterminate' : tone}
    >
      <span className={styles.progressFill} style={indeterminate ? undefined : { width: `${clamped}%` }} />
    </div>
  )
}
