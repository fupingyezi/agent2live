import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../src/primitives/actions/Button'
import { ActionBar } from '../src/primitives/layout/ActionBar'
import { AppFrame } from '../src/primitives/layout/AppFrame'
import { NavigationRail } from '../src/primitives/layout/NavigationRail'
import { PageHeader } from '../src/primitives/layout/PageHeader'
import { ScrollArea } from '../src/primitives/layout/ScrollArea'
import { SectionHeader } from '../src/primitives/layout/SectionHeader'
import { Toolbar } from '../src/primitives/layout/Toolbar'
import { WorkbenchLayout } from '../src/patterns/WorkbenchLayout'

describe('layout primitives', () => {
  it('renders page and section headers with actions', () => {
    render(
      <PageHeader
        eyebrow="Studio"
        title="角色"
        description="管理角色母体"
        actions={<Button>新建角色</Button>}
      />
    )
    expect(screen.getByRole('heading', { level: 1, name: '角色' })).toBeVisible()
    expect(screen.getByText('Studio')).toBeVisible()
    expect(screen.getByRole('button', { name: '新建角色' })).toBeVisible()
    render(
      <SectionHeader
        title="美术项目"
        description="独立演进"
        actions={<Button variant="quiet">排序</Button>}
      />
    )
    expect(screen.getByRole('heading', { level: 2, name: '美术项目' })).toBeVisible()
  })

  it('composes toolbar, action bar, and scroll area', async () => {
    const onClick = vi.fn()
    render(
      <>
        <Toolbar>
          <Button variant="quiet">筛选</Button>
        </Toolbar>
        <ScrollArea aria-label="版本列表">
          <p>版本 A</p>
        </ScrollArea>
        <ActionBar status="已保存">
          <Button onClick={onClick}>下一步</Button>
        </ActionBar>
      </>
    )
    expect(screen.getByRole('toolbar')).toBeInTheDocument()
    expect(screen.getByLabelText('版本列表')).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('status')).toHaveTextContent('已保存')
    await userEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('exposes the navigation rail as buttons with current state', async () => {
    const onSelect = vi.fn()
    render(
      <AppFrame
        navigation={
          <NavigationRail
            label="主导航"
            items={[
              { id: 'characters', label: '角色', icon: '人', active: true, onSelect },
              { id: 'settings', label: '设置', icon: '齿', onSelect }
            ]}
          />
        }
      >
        <p>页面</p>
      </AppFrame>
    )
    const nav = screen.getByRole('navigation', { name: '主导航' })
    expect(nav).toBeInTheDocument()
    const settings = screen.getByRole('button', { name: /设置/ })
    expect(screen.getByRole('button', { name: /角色/ })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(settings)
    expect(onSelect).toHaveBeenCalledWith('settings')
  })

  it('renders all workbench slots and collapses the inspector', () => {
    const { rerender } = render(
      <WorkbenchLayout
        context={<p>上下文</p>}
        inspector={<p>Inspector</p>}
        topbar={<p>顶栏</p>}
        actionBar={<p>操作条</p>}
      >
        <p>画布</p>
      </WorkbenchLayout>
    )
    expect(screen.getByText('上下文')).toBeVisible()
    expect(screen.getByText('Inspector')).toBeVisible()
    expect(screen.getByText('操作条')).toBeVisible()
    rerender(
      <WorkbenchLayout inspectorCollapsed context={<p>上下文</p>} inspector={<p>Inspector</p>}>
        <p>画布</p>
      </WorkbenchLayout>
    )
    expect(screen.queryByText('Inspector')).not.toBeInTheDocument()
  })
})
