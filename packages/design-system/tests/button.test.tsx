import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AsyncButton, Button, IconButton } from '../src'

describe('Button', () => {
  it('renders variants and forwards native button props', async () => {
    const onClick = vi.fn()
    render(
      <Button variant="primary" disabled={false} onClick={onClick}>
        保存
      </Button>
    )
    const button = screen.getByRole('button', { name: '保存' })
    expect(button).toHaveAttribute('type', 'button')
    await userEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('supports asChild navigation without nesting a button inside a link', () => {
    render(
      <Button asChild variant="secondary">
        <a href="/characters">角色</a>
      </Button>
    )
    const link = screen.getByRole('link', { name: '角色' })
    expect(link).toHaveAttribute('href', '/characters')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('does not fire while busy and exposes aria-busy', async () => {
    const onClick = vi.fn()
    render(
      <AsyncButton busy busyLabel="保存中…" onClick={onClick}>
        保存
      </AsyncButton>
    )
    const button = screen.getByRole('button', { name: '保存中…' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('requires an accessible name for icon buttons', () => {
    render(
      <IconButton label="收起侧栏" selected>
        ‹
      </IconButton>
    )
    const button = screen.getByRole('button', { name: '收起侧栏' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })
})
