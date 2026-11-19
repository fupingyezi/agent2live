import React, { forwardRef } from 'react'
import { cx } from '../../../internal/polymorphic'
import styles from './Switch.module.scss'

export interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
  busy?: boolean
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, busy = false, disabled, className, onClick, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={busy}
      disabled={disabled || busy}
      data-state={busy ? 'busy' : checked ? 'on' : 'off'}
      className={cx(styles.switch, className)}
      onClick={(event) => {
        onClick?.(event)
        onCheckedChange?.(!checked)
      }}
      {...rest}
    >
      <span className={styles.switchThumb} aria-hidden="true" />
    </button>
  )
})
