import React from 'react'
import { cx } from '../../internal/polymorphic'
import styles from '../../styles/primitives.module.css'

export interface CountBadgeProps {
  value: number
  max?: number
  className?: string
}

export const CountBadge: React.FC<CountBadgeProps> = ({ value, max = 99, className }) => {
  const overflow = value > max
  return (
    <span className={cx(styles.countBadge, className)} data-state={overflow ? 'overflow' : 'default'}>
      {overflow ? `${max}+` : value}
    </span>
  )
}
