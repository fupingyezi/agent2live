import React from 'react'
import { cx } from '../../internal/polymorphic'
import styles from '../../styles/primitives.module.css'

export interface InlineNoticeProps {
  tone?: 'info' | 'warning' | 'success' | 'danger'
  children: React.ReactNode
  className?: string
}

export const InlineNotice: React.FC<InlineNoticeProps> = ({ tone = 'info', children, className }) => {
  return (
    <div
      className={cx(
        styles.inlineNotice,
        styles[`notice${tone[0]!.toUpperCase()}${tone.slice(1)}`],
        className
      )}
      role="status"
      data-state={tone}
    >
      {children}
    </div>
  )
}
