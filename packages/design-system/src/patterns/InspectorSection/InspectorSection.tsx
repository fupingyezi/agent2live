import React from 'react'
import { cx } from '../../internal/polymorphic'
import styles from './InspectorSection.module.scss'

export interface InspectorSectionProps {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export const InspectorSection: React.FC<InspectorSectionProps> = ({
  title,
  description,
  actions,
  children,
  className
}) => {
  return (
    <section className={cx(styles.inspectorSection, className)}>
      <header className={styles.inspectorHeader}>
        <div>
          <h2 className={styles.inspectorTitle}>{title}</h2>
          {description ? <p className={styles.inspectorDescription}>{description}</p> : null}
        </div>
        {actions ? <div className={styles.inspectorActions}>{actions}</div> : null}
      </header>
      <div className={styles.inspectorBody}>{children}</div>
    </section>
  )
}
