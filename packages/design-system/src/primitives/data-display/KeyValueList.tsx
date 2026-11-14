import React from 'react'
import { cx } from '../../internal/polymorphic'
import styles from '../../styles/primitives.module.css'

export interface KeyValueItem {
  label: React.ReactNode
  value: React.ReactNode
}

export interface KeyValueListProps {
  items: KeyValueItem[]
  className?: string
}

export const KeyValueList: React.FC<KeyValueListProps> = ({ items, className }) => {
  return (
    <dl className={cx(styles.keyValueList, className)}>
      {items.map((item, index) => (
        <div key={index} className={styles.keyValueRow}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
