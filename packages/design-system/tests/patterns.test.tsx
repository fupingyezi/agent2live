import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from '../src/primitives/actions/Button'
import { InspectorSection } from '../src/patterns/InspectorSection'
import { ReviewFooter } from '../src/patterns/ReviewFooter'
import { StageRail } from '../src/patterns/StageRail'
import { TechnicalDetailsDisclosure } from '../src/patterns/TechnicalDetailsDisclosure'

describe('design-system patterns', () => {
  it('marks the current stage and uses shape plus text, not color alone', () => {
    render(
      <StageRail
        steps={[
          { id: 'brief', label: '角色设定', status: 'complete' },
          { id: 'prompt', label: '提示词', status: 'current' },
          { id: 'art', label: '立绘', status: 'blocked' }
        ]}
      />
    )
    const current = screen.getByText('提示词').closest('li')
    expect(current).toHaveAttribute('aria-current', 'step')
    expect(current).toHaveTextContent('●')
    const blocked = screen.getByText('立绘').closest('li')
    expect(blocked).toHaveTextContent('!')
  })

  it('composes inspector sections and technical details', () => {
    render(
      <InspectorSection title="参考图" description="按顺序排列">
        <TechnicalDetailsDisclosure summary="技术详情" defaultOpen>
          <p>sha256:abc</p>
        </TechnicalDetailsDisclosure>
      </InspectorSection>
    )
    expect(screen.getByRole('heading', { level: 2, name: '参考图' })).toBeVisible()
    expect(screen.getByText('sha256:abc')).toBeVisible()
    expect(screen.getByText('技术详情').closest('details')).toHaveAttribute('open')
  })

  it('leaves final actions to the caller', () => {
    render(
      <ReviewFooter
        summary="3 个素材，1 个主参考"
        secondary={<Button variant="quiet">返回</Button>}
        primary={<Button>接受版本</Button>}
      />
    )
    expect(screen.getByText('3 个素材，1 个主参考')).toBeVisible()
    expect(screen.getByRole('button', { name: '返回' })).toBeVisible()
    expect(screen.getByRole('button', { name: '接受版本' })).toBeVisible()
  })
})
