import React from 'react'
import { cx } from '../../internal/polymorphic'
import styles from '../../styles/primitives.module.css'

export interface EmptyStateProps {
  title: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  action?: React.ReactNode
  compact?: boolean
  className?: string
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  action,
  compact = false,
  className
}) => {
  return (
    <div
      className={cx(styles.emptyState, compact && styles.emptyStateCompact, className)}
      data-state={compact ? 'compact' : 'default'}
    >
      {icon ? (
        <div className={styles.emptyMark} aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h2 className={styles.emptyTitle}>{title}</h2>
      {description ? <p className={styles.emptyDescription}>{description}</p> : null}
      {action ? <div className={styles.emptyAction}>{action}</div> : null}
    </div>
  )
}
