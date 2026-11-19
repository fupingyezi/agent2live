import React from 'react'
import { Button, type ButtonProps } from '../Button'

export interface AsyncButtonProps extends ButtonProps {
  busy?: boolean
  busyLabel?: React.ReactNode
}

export const AsyncButton: React.FC<AsyncButtonProps> = ({
  busy = false,
  busyLabel = '处理中…',
  disabled,
  children,
  ...rest
}) => {
  return (
    <Button {...rest} disabled={busy || disabled} aria-busy={busy}>
      {busy ? busyLabel : children}
    </Button>
  )
}
