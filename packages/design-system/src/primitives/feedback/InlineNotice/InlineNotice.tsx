import React from 'react'
import { cx } from '../../../internal/polymorphic'
import styles from './InlineNotice.module.scss'

export interface InlineNoticeProps {
  tone?: 'info' | 'warning' | 'success' | 'danger'
  children: React.ReactNode
  className?: string
}

export const InlineNotice: React.FC<InlineNoticeProps> = ({ tone = 'info', children, className }) => {
  const toneClass = tone === 'info' ? undefined : styles[`notice${tone[0]!.toUpperCase()}${tone.slice(1)}`]

  return (
    <div className={cx(styles.inlineNotice, toneClass, className)} role="status" data-state={tone}>
      {children}
    </div>
  )
}
