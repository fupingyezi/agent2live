import React from 'react'
import { cx } from '../../../internal/polymorphic'
import styles from './Spinner.module.scss'

export interface SpinnerProps {
  label: string
  size?: 'sm' | 'md'
  className?: string
}

export const Spinner: React.FC<SpinnerProps> = ({ label, size = 'md', className }) => {
  return (
    <span
      className={cx(styles.spinner, styles[`spinner${size === 'sm' ? 'Sm' : 'Md'}`], className)}
      role="status"
      aria-label={label}
    />
  )
}
