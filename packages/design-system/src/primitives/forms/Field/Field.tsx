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

  let control = children
  let controlId = fieldId
  if (React.isValidElement(children)) {
    const element = children as React.ReactElement<Record<string, unknown>>
    controlId = typeof element.props.id === 'string' ? element.props.id : fieldId
    control = React.cloneElement(element, {
      id: controlId,
      'aria-invalid': invalid || undefined,
      'aria-describedby': invalid ? errorId : description ? descriptionId : undefined
    })
  }

  return (
    <div className={cx(styles.field, className)} data-state={invalid ? 'invalid' : 'default'}>
      <label className={styles.fieldLabel} htmlFor={controlId}>
        {label}
        {required ? (
          <span className={styles.required} aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </label>
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
