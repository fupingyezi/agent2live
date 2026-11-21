import React, { forwardRef } from 'react'
import { cx, renderAsChild } from '../../../internal/polymorphic'
import styles from './Button.module.scss'

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'ghost'

export type ButtonSize = 'sm' | 'md' | 'icon'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  asChild?: boolean
  leadingIcon?: React.ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    asChild = false,
    leadingIcon,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref
) {
  const classes = cx(styles.button, styles[variant], styles[size], className)

  if (asChild) {
    return renderAsChild(children, classes, rest as Record<string, unknown>)
  }

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      {...rest}
      data-state={rest.disabled ? 'disabled' : 'idle'}
    >
      {leadingIcon ? (
        <span className={styles.buttonIcon} aria-hidden="true">
          {leadingIcon}
        </span>
      ) : null}
      <span className={styles.buttonLabel}>{children}</span>
    </button>
  )
})
