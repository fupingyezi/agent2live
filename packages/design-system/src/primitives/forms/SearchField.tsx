import React, { forwardRef, useState } from 'react'
import { cx } from '../../internal/polymorphic'
import styles from '../../styles/primitives.module.css'
import { IconButton } from '../actions/IconButton'

export interface SearchFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  clearLabel: string
  onValueChange?: (value: string) => void
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { clearLabel, onValueChange, onChange, value, defaultValue, className, ...rest },
  ref
) {
  const [innerValue, setInnerValue] = useState(String(defaultValue ?? ''))
  const currentValue = value === undefined ? innerValue : String(value)

  return (
    <div className={cx(styles.searchField, className)}>
      <input
        ref={ref}
        type="search"
        className={styles.searchInput}
        value={value}
        defaultValue={defaultValue}
        onChange={(event) => {
          if (value === undefined) setInnerValue(event.target.value)
          onChange?.(event)
          onValueChange?.(event.target.value)
        }}
        {...rest}
      />
      {currentValue ? (
        <IconButton
          label={clearLabel}
          variant="quiet"
          className={styles.searchClear}
          onClick={() => {
            if (value === undefined) setInnerValue('')
            onValueChange?.('')
          }}
        >
          ×
        </IconButton>
      ) : null}
    </div>
  )
})
