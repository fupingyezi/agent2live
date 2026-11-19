import React from 'react'
import { cx, renderAsChild } from '../../../internal/polymorphic'
import styles from './SurfaceCard.module.scss'

export interface SurfaceCardProps {
  title?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  asChild?: boolean
  className?: string
  children?: React.ReactNode
}

export const SurfaceCard: React.FC<SurfaceCardProps> = ({
  title,
  description,
  actions,
  asChild = false,
  className,
  children
}) => {
  const classes = cx(styles.surfaceCard, className)
  if (asChild) return renderAsChild(children, classes)

  return (
    <section className={classes} data-state="default">
      {title || actions ? (
        <header className={styles.cardHeader}>
          <div>
            {title ? <h2 className={styles.cardTitle}>{title}</h2> : null}
            {description ? <p className={styles.cardDescription}>{description}</p> : null}
          </div>
          {actions ? <div className={styles.cardActions}>{actions}</div> : null}
        </header>
      ) : null}
      {children ? <div className={styles.cardBody}>{children}</div> : null}
    </section>
  )
}
