import type React from 'react'
import { createPortal } from 'react-dom'

export function renderPortal(node: React.ReactNode): React.ReactElement | null {
  if (typeof document === 'undefined') return null
  return createPortal(node, document.body)
}
