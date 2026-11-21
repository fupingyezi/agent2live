import React, { forwardRef } from 'react'
import { cx } from '../../../internal/polymorphic'
import styles from './Textarea.module.scss'

export type TextareaResize = 'none' | 'vertical' | 'horizontal' | 'both'

const RESIZE_CLASS: Record<TextareaResize, string | undefined> = {
  none: styles.resizeNone,
  vertical: styles.resizeVertical,
  horizontal: styles.resizeHorizontal,
  both: styles.resizeBoth
}

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
  resize?: TextareaResize
  onValueChange?: (value: string) => void
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, resize = 'none', className, onValueChange, onChange, rows = 4, ...rest },
  ref
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cx(styles.textarea, invalid && styles.invalid, RESIZE_CLASS[resize], className)}
      aria-invalid={invalid || undefined}
      onChange={(event) => {
        onChange?.(event)
        onValueChange?.(event.target.value)
      }}
      {...rest}
    />
  )
})
