import React from 'react'
import styles from './WorkbenchTopbar.module.scss'

export interface WorkbenchTopbarProps {
  title: string
  actions?: React.ReactNode
}

export const WorkbenchTopbar: React.FC<WorkbenchTopbarProps> = ({ title, actions }) => {
  return (
    <header className={styles['wb3-topbar']!} data-testid="wb3-topbar">
      <h1>{title}</h1>
      {actions ? <div className={styles['wb3-topbar-actions']!}>{actions}</div> : null}
    </header>
  )
}
