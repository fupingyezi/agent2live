import React, { useId } from 'react'
import { cx } from '../../../internal/polymorphic'
import styles from './Field.module.scss'

export interface FieldProps {
  id?: string
  label: React.ReactNode
  description?: React.ReactNode
  error?: React.ReactNode
  required?: boolean
  className?: string
  children: React.ReactNode
}

const LABELABLE_NATIVE_ELEMENTS = new Set([
  'input',
  'select',
  'textarea',
  'button',
  'meter',
  'output',
  'progress'
])

const NATIVE_REQUIRED_ELEMENTS = new Set(['input', 'select', 'textarea'])

export const Field: React.FC<FieldProps> = ({
  id,
  label,
  description,
  error,
  required = false,
  className,
  children
}) => {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const descriptionId = `${fieldId}-description`
  const errorId = `${fieldId}-error`
  const invalid = error !== undefined && error !== null && error !== ''

  const childArray = React.Children.toArray(children)
  const labelableIndex = childArray.findIndex((child) => {
    if (!React.isValidElement(child) || child.type === React.Fragment) return false
    const childType = typeof child.type === 'string' ? child.type : null
    return childType === null || LABELABLE_NATIVE_ELEMENTS.has(childType)
  })
  const labelableChild =
    labelableIndex >= 0 ? (childArray[labelableIndex] as React.ReactElement<Record<string, unknown>>) : null
  const labelable = labelableChild !== null

  let control: React.ReactNode = children
  let controlId = fieldId
  if (labelableChild) {
    const nativeType = typeof labelableChild.type === 'string' ? labelableChild.type : null
    controlId = typeof labelableChild.props.id === 'string' ? labelableChild.props.id : fieldId
    const cloned = React.cloneElement(labelableChild, {
      id: controlId,
      'aria-invalid': invalid || undefined,
      'aria-describedby': invalid ? errorId : description ? descriptionId : undefined,
      'aria-required': required || undefined,
      ...(nativeType && NATIVE_REQUIRED_ELEMENTS.has(nativeType) ? { required } : {})
    })
    control =
      childArray.length === 1
        ? cloned
        : childArray.map((child, index) => (index === labelableIndex ? cloned : child))
  }

  return (
    <div className={cx(styles.field, className)} data-state={invalid ? 'invalid' : 'default'}>
      {labelable ? (
        <label className={styles.fieldLabel} htmlFor={controlId}>
          {label}
          {required ? (
            <span className={styles.required} aria-hidden="true">
              {' '}
              *
            </span>
          ) : null}
        </label>
      ) : (
        <span className={styles.fieldLabel}>{label}</span>
      )}
      {control}
      {description ? (
        <p id={descriptionId} className={styles.fieldDescription}>
          {description}
        </p>
      ) : null}
      {invalid ? (
        <p id={errorId} className={styles.fieldError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
