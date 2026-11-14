import React from 'react'
import { cx } from '../../internal/polymorphic'
import styles from '../../styles/patterns.module.css'

export interface ToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  wrap?: boolean
}

export const Toolbar: React.FC<ToolbarProps> = ({ children, wrap = false, className, ...rest }) => {
  return (
    <div role="toolbar" className={cx(styles.toolbar, wrap && styles.toolbarWrap, className)} {...rest}>
      {children}
    </div>
  )
}
