import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  Button,
  CountBadge,
  EmptyState,
  ErrorState,
  InlineNotice,
  ProgressBar,
  StatusPill,
  SurfaceCard
} from '../src'

describe('feedback and data display', () => {
  it('expresses status with readable text and data-state', () => {
    render(<StatusPill label="已激活" tone="success" />)
    const pill = screen.getByText('已激活')
    expect(pill).toHaveAttribute('data-state', 'success')
  })

  it('renders an empty state with one next action', async () => {
    const onClick = vi.fn()
    render(
      <EmptyState
        title="还没有角色"
        description="先创建一个角色。"
        action={<Button onClick={onClick}>新建角色</Button>}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: '新建角色' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('keeps support codes behind a disclosure and exposes recovery actions', async () => {
    const onRetry = vi.fn()
    render(
      <ErrorState
        title="无法连接本地工作台"
        description="请重启应用后重试。"
        code="SYS_SIDECAR_UNAVAILABLE"
        supportId="sup_123"
        retryLabel="重试"
        onRetry={onRetry}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('无法连接本地工作台')
    const details = screen.getByText('技术详情').closest('details')
    expect(details).not.toHaveAttribute('open')
    expect(screen.getByText('SYS_SIDECAR_UNAVAILABLE')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('renders determinate progress with an accessible value', () => {
    render(<ProgressBar label="任务进度" value={42} />)
    const bar = screen.getByRole('progressbar', { name: '任务进度' })
    expect(bar).toHaveAttribute('aria-valuenow', '42')
  })

  it('caps count badges and supports asChild surfaces', () => {
    render(<CountBadge value={120} max={99} />)
    expect(screen.getByText('99+')).toBeInTheDocument()
    render(
      <SurfaceCard asChild>
        <a href="/characters/chr_1">角色卡片</a>
      </SurfaceCard>
    )
    expect(screen.getByRole('link', { name: '角色卡片' })).toBeInTheDocument()
  })

  it('uses role status for inline notices', () => {
    render(<InlineNotice tone="warning">素材尚未上传</InlineNotice>)
    expect(screen.getByRole('status')).toHaveTextContent('素材尚未上传')
  })
})
