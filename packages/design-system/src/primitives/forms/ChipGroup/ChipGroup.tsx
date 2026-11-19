import React from 'react'
import { cx } from '../../../internal/polymorphic'
import styles from './ChipGroup.module.scss'

export interface ChipGroupOption {
  id: string
  label: React.ReactNode
  count?: number
  disabled?: boolean
}

export interface ChipGroupProps {
  ariaLabel: string
  options: ChipGroupOption[]
  value: string | null
  onValueChange(value: string): void
  disabled?: boolean
  className?: string
}

export const ChipGroup: React.FC<ChipGroupProps> = ({
  ariaLabel,
  options,
  value,
  onValueChange,
  disabled = false,
  className
}) => {
  return (
    <div className={cx(styles.chipGroup, className)} role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const selected = option.id === value
        return (
          <button
            key={option.id}
            type="button"
            className={styles.chip}
            aria-pressed={selected}
            data-state={selected ? 'selected' : 'default'}
            disabled={disabled || option.disabled}
            onClick={() => onValueChange(option.id)}
          >
            <span>{option.label}</span>
            {option.count !== undefined ? <span className={styles.chipCount}>{option.count}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
