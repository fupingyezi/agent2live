import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ChipGroup } from '../src'

describe('ChipGroup', () => {
  it('renders options with counts and pressed state', () => {
    render(
      <ChipGroup
        ariaLabel="提示词筛选"
        value="all"
        onValueChange={() => undefined}
        options={[
          { id: 'all', label: '全部', count: 8 },
          { id: 'face', label: '面部', count: 2 }
        ]}
      />
    )
    expect(screen.getByRole('group', { name: '提示词筛选' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /全部/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /面部/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('8')).toBeInTheDocument()
  })

  it('emits the selected option and ignores disabled options', async () => {
    const onValueChange = vi.fn()
    render(
      <ChipGroup
        ariaLabel="权重"
        value={null}
        onValueChange={onValueChange}
        options={[
          { id: '1.0', label: '1.0' },
          { id: '1.3', label: '1.3' },
          { id: '2.0', label: '2.0', disabled: true }
        ]}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: '1.3' }))
    expect(onValueChange).toHaveBeenLastCalledWith('1.3')
    await userEvent.click(screen.getByRole('button', { name: '2.0' }))
    expect(onValueChange).toHaveBeenCalledTimes(1)
  })
})
