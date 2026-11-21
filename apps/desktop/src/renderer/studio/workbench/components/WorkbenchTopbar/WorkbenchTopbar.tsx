import React from 'react'
import styles from './WorkbenchTopbar.module.scss'

export interface WorkbenchTopbarProps {
  title: string
  subtitle?: string | null
  actions?: React.ReactNode
}

export const WorkbenchTopbar: React.FC<WorkbenchTopbarProps> = ({ title, subtitle, actions }) => {
  return (
    <header className={styles['wb3-topbar']!} data-testid="wb3-topbar">
      <div className={styles['wb3-topbar-heading']!}>
        <h1>{title}</h1>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
      {actions ? <div className={styles['wb3-topbar-actions']!}>{actions}</div> : null}
    </header>
  )
}
