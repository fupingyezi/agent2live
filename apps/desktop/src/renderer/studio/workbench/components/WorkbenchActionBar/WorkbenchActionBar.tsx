import React from 'react'
import { ActionBar } from '@agent2live/design-system'
import styles from './WorkbenchActionBar.module.scss'

export interface WorkbenchActionBarProps {
  status?: React.ReactNode
  busy?: boolean
  children: React.ReactNode
}

export const WorkbenchActionBar: React.FC<WorkbenchActionBarProps> = ({ status, busy = false, children }) => {
  return (
    <ActionBar status={status} busy={busy} className={styles['wb3-actionbar']!} testId="wb3-actionbar">
      {children}
    </ActionBar>
  )
}
