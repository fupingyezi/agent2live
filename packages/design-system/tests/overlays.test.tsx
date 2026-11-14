import React, { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../src/primitives/actions/Button'
import { ConfirmDialog } from '../src/primitives/overlays/ConfirmDialog'
import { Dialog } from '../src/primitives/overlays/Dialog'
import { Drawer } from '../src/primitives/overlays/Drawer'
import { Popover } from '../src/primitives/overlays/Popover'
import { Tooltip } from '../src/primitives/overlays/Tooltip'
import type { EmptyProps } from '../src/types'

describe('overlays', () => {
  it('traps focus, closes on Escape, and restores trigger focus', async () => {
    const Harness: React.FC<EmptyProps> = () => {
      const [open, setOpen] = useState(false)
      return (
        <>
          <Button onClick={() => setOpen(true)}>打开</Button>
          <Dialog open={open} onOpenChange={setOpen} title="设置" description="修改本地配置">
            <Button>保存</Button>
          </Dialog>
        </>
      )
    }
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: '打开' })
    await userEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: '设置' })).toBeVisible()
    expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('does not confirm while busy', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog open title="删除项目" busy destructive onConfirm={onConfirm} onCancel={onCancel}>
        此操作不可撤销。
      </ConfirmDialog>
    )
    expect(screen.getByRole('button', { name: '处理中…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('renders a drawer with an accessible name', () => {
    render(
      <Drawer open onOpenChange={() => undefined} title="版本详情" side="right">
        <p>内容</p>
      </Drawer>
    )
    expect(screen.getByRole('dialog', { name: '版本详情' })).toBeVisible()
  })

  it('describes tooltip content and toggles a popover', async () => {
    render(
      <Tooltip label="查看参考图">
        <button type="button">参考</button>
      </Tooltip>
    )
    const trigger = screen.getByRole('button', { name: '参考' })
    await userEvent.hover(trigger)
    expect(screen.getByRole('tooltip')).toHaveTextContent('查看参考图')

    render(
      <Popover trigger={<Button>更多操作</Button>} label="更多操作">
        <p>菜单内容</p>
      </Popover>
    )
    await userEvent.click(screen.getByRole('button', { name: '更多操作' }))
    expect(screen.getByRole('dialog', { name: '更多操作' })).toBeVisible()
  })
})
