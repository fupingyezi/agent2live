const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

export function focusablesIn(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.getAttribute('aria-hidden') !== 'true'
  )
}

export function focusFirst(container: HTMLElement | null): void {
  focusablesIn(container)[0]?.focus()
}

export function trapTab(event: KeyboardEvent, container: HTMLElement | null): void {
  if (event.key !== 'Tab') return
  const focusables = focusablesIn(container)
  if (focusables.length === 0) {
    event.preventDefault()
    return
  }
  const first = focusables[0]!
  const last = focusables[focusables.length - 1]!
  const active = document.activeElement
  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}
