import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Accordion } from '../src/primitives/navigation/Accordion'
import { Disclosure } from '../src/primitives/navigation/Disclosure'
import { Tabs } from '../src/primitives/navigation/Tabs'

describe('navigation', () => {
  it('switches tabs with arrow keys and exposes tabpanel', async () => {
    const onValueChange = vi.fn()
    render(
      <Tabs
        label="工作台视图"
        items={[
          { id: 'references', label: '参考图', content: <p>参考图内容</p> },
          { id: 'candidates', label: '候选', content: <p>候选内容</p> }
        ]}
        defaultValue="references"
        onValueChange={onValueChange}
      />
    )
    const references = screen.getByRole('tab', { name: '参考图' })
    const candidates = screen.getByRole('tab', { name: '候选' })
    expect(references).toHaveAttribute('aria-selected', 'true')
    references.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onValueChange).toHaveBeenLastCalledWith('candidates')
    expect(candidates).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('候选内容')
  })

  it('expands accordion panels and disclosure content', async () => {
    render(
      <Accordion
        items={[
          { id: 'prompt', title: '提示词', content: <p>提示词详情</p> },
          { id: 'art', title: '立绘', content: <p>立绘详情</p> }
        ]}
      />
    )
    expect(screen.queryByText('提示词详情')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '提示词' }))
    expect(screen.getByText('提示词详情')).toBeVisible()
    expect(screen.getByRole('button', { name: '提示词' })).toHaveAttribute('aria-expanded', 'true')

    render(
      <Disclosure summary="技术详情">
        <p>模型 hash</p>
      </Disclosure>
    )
    await userEvent.click(screen.getByRole('button', { name: '技术详情' }))
    expect(screen.getByText('模型 hash')).toBeVisible()
  })
})
