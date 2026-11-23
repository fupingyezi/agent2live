import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './ProvidersPage.module.scss'

export interface ProviderSelectOption {
  value: string
  label: string
}

export interface ProviderSelectProps {
  id?: string
  value: string
  options: ProviderSelectOption[]
  disabled?: boolean
  'aria-invalid'?: boolean | 'true' | 'false'
  'aria-describedby'?: string
  onValueChange(value: string): void
  testId?: string
}

export const ProviderSelect: React.FC<ProviderSelectProps> = ({
  id,
  value,
  options,
  disabled = false,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  onValueChange,
  testId
}) => {
  const menuId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties | null>(null)
  const selected = options.find((option) => option.value === value) ?? options[0] ?? null

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom - 16
    setMenuStyle({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      maxHeight: Math.max(120, Math.min(320, spaceBelow))
    })
  }, [])

  const closeMenu = useCallback((focusTrigger = true) => {
    setOpen(false)
    if (focusTrigger) triggerRef.current?.focus()
  }, [])

  const openMenu = useCallback(() => {
    if (disabled) return
    const index = options.findIndex((option) => option.value === value)
    setActiveIndex(Math.max(0, index))
    updatePosition()
    setOpen(true)
  }, [disabled, options, value, updatePosition])

  useEffect(() => {
    if (!disabled) return
    setOpen(false)
  }, [disabled])

  useEffect(() => {
    if (!open) return
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      closeMenu(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, closeMenu])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault()
        event.stopImmediatePropagation()
        closeMenu()
        return
      }
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'Home' ||
        event.key === 'End'
      ) {
        event.preventDefault()
        setActiveIndex((current) => {
          if (event.key === 'Home') return 0
          if (event.key === 'End') return Math.max(0, options.length - 1)
          if (event.key === 'ArrowDown') return Math.min(options.length - 1, current + 1)
          return Math.max(0, current - 1)
        })
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, options.length, closeMenu])

  useEffect(() => {
    if (!open) return
    const option = menuRef.current?.querySelector<HTMLButtonElement>(`[data-option-index="${activeIndex}"]`)
    option?.focus()
    option?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  const choose = (index: number): void => {
    const option = options[index]
    if (!option) return
    onValueChange(option.value)
    closeMenu()
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={styles['provider-select']!}
        data-testid={testId}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={ariaDescribedBy}
        onClick={() => {
          if (open) closeMenu(false)
          else openMenu()
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            openMenu()
          }
        }}
      >
        <span className={styles['provider-select-value']!}>{selected?.label ?? '请选择'}</span>
        <svg
          className={styles['provider-select-chevron']!}
          viewBox="0 0 12 12"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M2.5 4.5 6 8l3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && menuStyle
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="listbox"
              aria-label="选择选项"
              className={styles['provider-select-menu']!}
              data-testid={testId ? `${testId}-menu` : undefined}
              style={menuStyle}
            >
              {options.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={option.value === value}
                  className={styles['provider-select-option']!}
                  data-option-index={index}
                  data-value={option.value}
                  data-selected={option.value === value ? 'true' : 'false'}
                  data-testid={testId ? `${testId}-option` : undefined}
                  onClick={() => choose(index)}
                >
                  {option.label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
