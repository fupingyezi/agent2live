import React from 'react'
import { cx } from '../internal/polymorphic'
import styles from '../styles/patterns.module.css'

export interface ReviewFooterProps {
  summary: React.ReactNode
  secondary?: React.ReactNode
  primary: React.ReactNode
  className?: string
}

export const ReviewFooter: React.FC<ReviewFooterProps> = ({ summary, secondary, primary, className }) => {
  return (
    <footer className={cx(styles.reviewFooter, className)}>
      <div className={styles.reviewSummary}>{summary}</div>
      <div className={styles.reviewActions}>
        {secondary}
        {primary}
      </div>
    </footer>
  )
}
