import React from 'react'
import { cx } from '../../internal/polymorphic'
import styles from './TechnicalDetailsDisclosure.module.scss'

export interface TechnicalDetailsDisclosureProps {
  summary: React.ReactNode
  children: React.ReactNode
  className?: string
  defaultOpen?: boolean
}

export const TechnicalDetailsDisclosure: React.FC<TechnicalDetailsDisclosureProps> = ({
  summary,
  children,
  className,
  defaultOpen = false
}) => {
  return (
    <details
      className={cx(styles.technicalDetails, className)}
      open={defaultOpen || undefined}
      data-state={defaultOpen ? 'open' : 'closed'}
    >
      <summary className={styles.technicalSummary}>{summary}</summary>
      <div className={styles.technicalBody}>{children}</div>
    </details>
  )
}
