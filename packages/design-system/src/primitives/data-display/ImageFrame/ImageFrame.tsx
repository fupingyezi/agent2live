import React from 'react'
import { cx } from '../../../internal/polymorphic'
import styles from './ImageFrame.module.scss'

export interface ImageFrameProps extends React.HTMLAttributes<HTMLDivElement> {
  selected?: boolean
  children: React.ReactNode
}

export const ImageFrame: React.FC<ImageFrameProps> = ({ selected = false, className, children, ...rest }) => {
  return (
    <div
      className={cx(styles.imageFrame, className)}
      data-state={selected ? 'selected' : 'default'}
      {...rest}
    >
      {children}
    </div>
  )
}
