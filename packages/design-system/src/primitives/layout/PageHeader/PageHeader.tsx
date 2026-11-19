import React from 'react'
import { cx } from '../../../internal/polymorphic'
import styles from './PageHeader.module.scss'

export interface PageHeaderProps {
  eyebrow?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  back?: React.ReactNode
  compact?: boolean
  className?: string
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  eyebrow,
  title,
  description,
  actions,
  back,
  compact = false,
  className
}) => {
  return (
    <header className={cx(styles.pageHeader, compact && styles.pageHeaderCompact, className)}>
      {back ? <div className={styles.pageBack}>{back}</div> : null}
      <div className={styles.pageHeaderMain}>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h1 className={styles.pageTitle}>{title}</h1>
        {description ? <p className={styles.pageDescription}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.pageActions}>{actions}</div> : null}
    </header>
  )
}
