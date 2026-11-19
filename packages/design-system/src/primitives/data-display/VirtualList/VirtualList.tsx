import React, { useMemo, useState } from 'react'
import { cx } from '../../../internal/polymorphic'
import styles from './VirtualList.module.scss'

export interface VirtualListProps<T> {
  items: T[]
  rowHeight: number
  height: number
  getKey: (item: T, index: number) => string
  renderItem: (item: T, index: number) => React.ReactNode
  label: string
  className?: string
}

interface VirtualListComponent {
  <T>(props: VirtualListProps<T>): React.ReactElement
}

export const VirtualList: VirtualListComponent = ({
  items,
  rowHeight,
  height,
  getKey,
  renderItem,
  label,
  className
}) => {
  const [scrollTop, setScrollTop] = useState(0)
  const overscan = 4
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const visible = Math.ceil(height / rowHeight) + overscan * 2
  const end = Math.min(items.length, start + visible)
  const rows = useMemo(() => items.slice(start, end), [items, start, end])

  return (
    <div
      className={cx(styles.virtualViewport, className)}
      style={{ height }}
      tabIndex={0}
      aria-label={label}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className={styles.virtualInner} style={{ height: items.length * rowHeight }}>
        {rows.map((item, index) => {
          const itemIndex = start + index
          return (
            <div
              key={getKey(item, itemIndex)}
              className={styles.virtualRow}
              style={{ height: rowHeight, transform: `translateY(${itemIndex * rowHeight}px)` }}
            >
              {renderItem(item, itemIndex)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
