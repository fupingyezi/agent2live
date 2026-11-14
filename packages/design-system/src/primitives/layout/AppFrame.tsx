import React from 'react'
import { cx } from '../../internal/polymorphic'
import styles from '../../styles/patterns.module.css'

export interface AppFrameProps {
  navigation: React.ReactNode
  children: React.ReactNode
  className?: string
}

export const AppFrame: React.FC<AppFrameProps> = ({ navigation, children, className }) => {
  return (
    <div className={cx(styles.appFrame, className)} data-theme="studio">
      <div className={styles.appFrameNav}>{navigation}</div>
      <main className={styles.appFrameMain}>{children}</main>
    </div>
  )
}
