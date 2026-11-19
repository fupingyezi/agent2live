import React from 'react'
import { cx } from '../../../internal/polymorphic'
import styles from './SectionHeader.module.scss'

export interface SectionHeaderProps {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({ title, description, actions, className }) => {
  return (
    <div className={cx(styles.sectionHeader, className)}>
      <div>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {description ? <p className={styles.sectionDescription}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.sectionActions}>{actions}</div> : null}
    </div>
  )
}
