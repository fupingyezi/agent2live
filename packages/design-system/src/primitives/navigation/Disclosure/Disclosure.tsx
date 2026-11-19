import React, { useId, useState } from 'react'
import { cx } from '../../../internal/polymorphic'
import styles from './Disclosure.module.scss'

export interface DisclosureProps {
  summary: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
  className?: string
}

export const Disclosure: React.FC<DisclosureProps> = ({
  summary,
  children,
  defaultOpen = false,
  className
}) => {
  const id = useId()
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={cx(styles.disclosure, className)} data-state={open ? 'expanded' : 'collapsed'}>
      <button
        type="button"
        className={styles.disclosureButton}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{summary}</span>
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open ? (
        <div id={id} className={styles.disclosurePanel}>
          {children}
        </div>
      ) : null}
    </div>
  )
}
