import React, { forwardRef } from 'react'
import { cx } from '../../../internal/polymorphic'
import styles from './TextField.module.scss'

export interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
  onValueChange?: (value: string) => void
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { invalid = false, className, onValueChange, onChange, ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      className={cx(styles.input, invalid && styles.invalid, className)}
      aria-invalid={invalid || undefined}
      onChange={(event) => {
        onChange?.(event)
        onValueChange?.(event.target.value)
      }}
      {...rest}
    />
  )
})
