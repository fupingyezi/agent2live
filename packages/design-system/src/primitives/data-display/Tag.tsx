import React from 'react'
import { cx } from '../../internal/polymorphic'
import styles from '../../styles/primitives.module.css'

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode
}

export const Tag: React.FC<TagProps> = ({ className, children, ...rest }) => {
  return (
    <span className={cx(styles.tag, className)} {...rest}>
      {children}
    </span>
  )
}
