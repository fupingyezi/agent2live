import React, { forwardRef } from 'react'
import { cx } from '../../../internal/polymorphic'
import styles from './Textarea.module.scss'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
  onValueChange?: (value: string) => void
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, className, onValueChange, onChange, rows = 4, ...rest },
  ref
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cx(styles.textarea, invalid && styles.invalid, className)}
      aria-invalid={invalid || undefined}
      onChange={(event) => {
        onChange?.(event)
        onValueChange?.(event.target.value)
      }}
      {...rest}
    />
  )
})
