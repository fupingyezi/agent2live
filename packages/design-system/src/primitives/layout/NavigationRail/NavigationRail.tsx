import React from 'react'
import { cx } from '../../../internal/polymorphic'
import styles from './NavigationRail.module.scss'

export interface NavigationItem {
  id: string
  label: string
  icon?: React.ReactNode
  active?: boolean
  disabled?: boolean
  onSelect: (id: string) => void
}

export interface NavigationRailProps {
  label: string
  items: NavigationItem[]
  brand?: React.ReactNode
  collapsed?: boolean
  stacked?: boolean
  className?: string
}

export const NavigationRail: React.FC<NavigationRailProps> = ({
  label,
  items,
  brand,
  collapsed = false,
  stacked = false,
  className
}) => {
  return (
    <nav
      className={cx(
        styles.navigationRail,
        collapsed && styles.navigationRailCollapsed,
        stacked && styles.navigationRailStacked,
        className
      )}
      aria-label={label}
      data-state={collapsed ? 'collapsed' : 'default'}
    >
      <span className={styles.railBrand} aria-hidden="true">
        {brand ?? 'a2l'}
      </span>
      <div className={styles.railItems} data-testid="studio-nav-icons">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={styles.railItem}
            aria-current={item.active ? 'page' : undefined}
            aria-label={collapsed ? item.label : undefined}
            disabled={item.disabled}
            data-state={item.active ? 'active' : 'default'}
            onClick={() => item.onSelect(item.id)}
          >
            <span className={styles.railIcon} aria-hidden="true">
              {item.icon ?? item.label.slice(0, 1)}
            </span>
            {!collapsed ? <span className={styles.railLabel}>{item.label}</span> : null}
          </button>
        ))}
      </div>
    </nav>
  )
}
