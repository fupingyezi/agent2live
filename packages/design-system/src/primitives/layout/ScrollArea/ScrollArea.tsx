import React, { forwardRef } from 'react'
import { cx } from '../../../internal/polymorphic'
import styles from './ScrollArea.module.scss'

export interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea(
  { children, className, ...rest },
  ref
) {
  return (
    <div ref={ref} className={cx(styles.scrollArea, className)} tabIndex={0} {...rest}>
      {children}
    </div>
  )
})
