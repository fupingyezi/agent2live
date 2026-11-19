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
    <select
      ref={ref}
      className={cx(styles.select, invalid && styles.invalid, className)}
      aria-invalid={invalid || undefined}
      onChange={(event) => {
        onChange?.(event)
        onValueChange?.(event.target.value)
      }}
      {...rest}
    >
      {children}
    </select>
  )
})
