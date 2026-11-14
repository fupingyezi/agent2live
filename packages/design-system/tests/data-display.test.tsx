import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ImageFrame } from '../src/primitives/data-display/ImageFrame'
import { KeyValueList } from '../src/primitives/data-display/KeyValueList'
import { Tag } from '../src/primitives/data-display/Tag'
import { Thumbnail } from '../src/primitives/data-display/Thumbnail'
import { VirtualList } from '../src/primitives/data-display/VirtualList'

describe('data display primitives', () => {
  it('falls back when a thumbnail fails', () => {
    render(<Thumbnail src="/missing.png" alt="参考图" fallback="无预览" />)
    fireEvent.error(screen.getByRole('img', { name: '参考图' }))
    expect(screen.getByRole('img', { name: '参考图' })).toHaveTextContent('无预览')
  })

  it('renders selected frames, key values, and tags', () => {
    render(
      <ImageFrame selected>
        <span>主参考</span>
      </ImageFrame>
    )
    expect(screen.getByText('主参考').parentElement).toHaveAttribute('data-state', 'selected')
    render(<KeyValueList items={[{ label: '版本', value: 'v3' }]} />)
    expect(screen.getByText('版本')).toBeVisible()
    expect(screen.getByText('v3')).toBeVisible()
    const tag = render(<Tag>主参考</Tag>)
    expect(within(tag.container).getByText('主参考')).toBeInTheDocument()
  })

  it('virtualizes a long list with a labelled viewport', () => {
    render(
      <VirtualList
        items={Array.from({ length: 100 }, (_, index) => `版本 ${index + 1}`)}
        rowHeight={32}
        height={128}
        getKey={(item) => item}
        label="版本列表"
        renderItem={(item) => <span>{item}</span>}
      />
    )
    expect(screen.getByLabelText('版本列表')).toBeInTheDocument()
    expect(screen.getByText('版本 1')).toBeVisible()
    expect(screen.queryByText('版本 100')).not.toBeInTheDocument()
  })
})
