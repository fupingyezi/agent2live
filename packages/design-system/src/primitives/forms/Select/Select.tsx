import React, { forwardRef } from 'react'
import { cx } from '../../../internal/polymorphic'
import styles from './Select.module.scss'

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean
  onValueChange?: (value: string) => void
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid = false, className, onValueChange, onChange, children, ...rest },
  ref
) {
  return (
    <span className={cx(styles.wrapper, className)}>
      <select
        ref={ref}
        className={cx(styles.select, invalid && styles.invalid)}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          onChange?.(event)
          onValueChange?.(event.target.value)
        }}
        {...rest}
      >
        {children}
      </select>
      <svg className={styles.chevron} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <path
          d="M2.5 4.5 6 8l3.5-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
})
