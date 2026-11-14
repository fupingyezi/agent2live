import React, { forwardRef, useRef, useState } from 'react'
import { cx } from '../../internal/polymorphic'
import styles from '../../styles/primitives.module.css'

export interface FileDropZoneProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  label: string
  onFiles?: (files: File[]) => void
  children: React.ReactNode
}

export const FileDropZone = forwardRef<HTMLInputElement, FileDropZoneProps>(function FileDropZone(
  { label, onFiles, children, className, accept, multiple, disabled, ...rest },
  ref
) {
  const [dragging, setDragging] = useState(false)
  const fallbackRef = useRef<HTMLInputElement>(null)

  return (
    <label
      className={cx(styles.dropZone, className)}
      data-state={disabled ? 'disabled' : dragging ? 'dragover' : 'idle'}
      onDragOver={(event) => {
        if (disabled) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        if (disabled) return
        event.preventDefault()
        setDragging(false)
        const files = Array.from(event.dataTransfer.files)
        if (files.length > 0) onFiles?.(files)
      }}
    >
      <input
        ref={ref ?? fallbackRef}
        type="file"
        className={styles.fileInput}
        aria-label={label}
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          if (files.length > 0) onFiles?.(files)
          event.target.value = ''
        }}
        {...rest}
      />
      <span className={styles.dropZoneContent}>{children}</span>
    </label>
  )
})
