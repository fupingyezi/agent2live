import React, { forwardRef } from 'react'
import { cx } from '../../../internal/polymorphic'
import styles from './IconButton.module.scss'
import { Button, type ButtonProps } from '../Button'

export interface IconButtonProps extends Omit<ButtonProps, 'asChild' | 'children' | 'size'> {
  label: string
  selected?: boolean
  children: React.ReactNode
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, selected, className, children, ...rest },
  ref
) {
  return (
    <Button
      ref={ref}
      size="icon"
      aria-label={label}
      aria-pressed={selected || undefined}
      className={cx(styles.iconButton, className)}
      {...rest}
    >
      {children}
    </Button>
  )
})
