import React from 'react'
import { cx } from '../../internal/polymorphic'
import styles from '../../styles/primitives.module.css'

export interface ThumbnailProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  alt: string
  fallback?: React.ReactNode
}

export const Thumbnail: React.FC<ThumbnailProps> = ({ alt, fallback = '—', className, onError, ...rest }) => {
  const [failed, setFailed] = React.useState(false)
  if (failed)
    return (
      <div className={cx(styles.thumbnailFallback, className)} role="img" aria-label={alt}>
        {fallback}
      </div>
    )
  return (
    <img
      className={cx(styles.thumbnail, className)}
      alt={alt}
      onError={(event) => {
        setFailed(true)
        onError?.(event)
      }}
      {...rest}
    />
  )
}
