import React from 'react'
import { cx } from '../internal/polymorphic'
import styles from '../styles/patterns.module.css'

export interface WorkbenchLayoutProps {
  topbar?: React.ReactNode
  context?: React.ReactNode
  inspector?: React.ReactNode
  actionBar?: React.ReactNode
  contextCollapsed?: boolean
  inspectorCollapsed?: boolean
  contextLabel?: string
  inspectorLabel?: string
  children: React.ReactNode
  className?: string
}

export const WorkbenchLayout: React.FC<WorkbenchLayoutProps> = ({
  topbar,
  context,
  inspector,
  actionBar,
  contextCollapsed = false,
  inspectorCollapsed = false,
  contextLabel = '页面上下文',
  inspectorLabel = 'Inspector',
  children,
  className
}) => {
  return (
    <div
      className={cx(styles.workbench, className)}
      data-context={contextCollapsed ? 'collapsed' : 'open'}
      data-inspector={inspectorCollapsed ? 'collapsed' : 'open'}
    >
      {topbar ? <header className={styles.workbenchTopbar}>{topbar}</header> : null}
      <div className={styles.workbenchBody}>
        {context && !contextCollapsed ? (
          <aside className={styles.workbenchContext} aria-label={contextLabel}>
            {context}
          </aside>
        ) : null}
        <main className={styles.workbenchCanvas}>{children}</main>
        {inspector && !inspectorCollapsed ? (
          <aside className={styles.workbenchInspector} aria-label={inspectorLabel}>
            {inspector}
          </aside>
        ) : null}
      </div>
      {actionBar ? <div className={styles.workbenchActions}>{actionBar}</div> : null}
    </div>
  )
}
