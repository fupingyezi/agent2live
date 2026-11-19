import React from 'react'
import { cx } from '../../../internal/polymorphic'
import styles from './ActionBar.module.scss'
import { Spinner } from '../../feedback/Spinner'

export interface ActionBarProps {
  status?: React.ReactNode
  busy?: boolean
  children: React.ReactNode
  className?: string
  testId?: string
}

export const ActionBar: React.FC<ActionBarProps> = ({
  status,
  busy = false,
  children,
  className,
  testId
}) => {
  return (
    <footer
      className={cx(styles.actionBar, className)}
      data-state={busy ? 'busy' : 'default'}
      data-testid={testId}
    >
      <div className={styles.actionBarStatus} role="status" aria-live="polite">
        {busy ? <Spinner label="处理中" size="sm" /> : null}
        {status}
      </div>
      <div className={styles.actionBarActions}>{children}</div>
    </footer>
  )
}
