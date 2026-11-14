import React, { useId, useState } from 'react'
import { cx } from '../../internal/polymorphic'
import styles from '../../styles/primitives.module.css'

export interface TabItem {
  id: string
  label: React.ReactNode
  content?: React.ReactNode
  disabled?: boolean
}

export interface TabsProps {
  items: TabItem[]
  label: string
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  className?: string
}

export const Tabs: React.FC<TabsProps> = ({
  items,
  label,
  value,
  defaultValue,
  onValueChange,
  className
}) => {
  const baseId = useId()
  const first = items.find((item) => !item.disabled)?.id ?? ''
  const [innerValue, setInnerValue] = useState(defaultValue ?? first)
  const active = value === undefined ? innerValue : value
  const activeItem = items.find((item) => item.id === active)

  const select = (next: string): void => {
    if (value === undefined) setInnerValue(next)
    onValueChange?.(next)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const enabled = items.filter((item) => !item.disabled)
    const index = enabled.findIndex((item) => item.id === active)
    if (index < 0) return
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const next = enabled[(index + delta + enabled.length) % enabled.length]!
    select(next.id)
    document.getElementById(`${baseId}-tab-${next.id}`)?.focus()
  }

  return (
    <div className={cx(styles.tabs, className)}>
      <div role="tablist" aria-label={label} className={styles.tabList} onKeyDown={onKeyDown}>
        {items.map((item) => {
          const selected = item.id === active
          return (
            <button
              key={item.id}
              id={`${baseId}-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              className={styles.tab}
              data-state={selected ? 'active' : 'default'}
              onClick={() => select(item.id)}
            >
              {item.label}
            </button>
          )
        })}
      </div>
      {activeItem ? (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${activeItem.id}`}
          aria-labelledby={`${baseId}-tab-${activeItem.id}`}
          className={styles.tabPanel}
        >
          {activeItem.content}
        </div>
      ) : null}
    </div>
  )
}
