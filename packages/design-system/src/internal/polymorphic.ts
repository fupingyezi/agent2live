import React from 'react'

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export function renderAsChild(
  child: React.ReactNode,
  className: string,
  props: Record<string, unknown> = {}
): React.ReactElement {
  if (!React.isValidElement(child)) {
    throw new Error('asChild requires exactly one React element')
  }
  const element = child as React.ReactElement<Record<string, unknown>>
  const childClassName = typeof element.props.className === 'string' ? element.props.className : ''
  return React.cloneElement(element, {
    ...props,
    className: cx(childClassName, className)
  })
}
