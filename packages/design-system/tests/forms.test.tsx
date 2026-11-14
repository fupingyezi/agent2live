import React, { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  Field,
  FileDropZone,
  SearchField,
  Select,
  Switch,
  Textarea,
  TextField,
  type EmptyProps
} from '../src'

describe('forms', () => {
  it('associates a field label, description and error with the input', () => {
    render(
      <Field label="角色名称" description="最多 100 个字符" error="请输入角色名称">
        <TextField />
      </Field>
    )
    const input = screen.getByLabelText('角色名称')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toContain('error')
    expect(screen.getByRole('alert')).toHaveTextContent('请输入角色名称')
  })

  it('supports controlled and uncontrolled text fields', async () => {
    const Controlled: React.FC<EmptyProps> = () => {
      const [value, setValue] = useState('')
      return <TextField aria-label="名称" value={value} onValueChange={setValue} />
    }
    render(<Controlled />)
    const input = screen.getByRole('textbox', { name: '名称' })
    await userEvent.type(input, '凛')
    expect(input).toHaveValue('凛')

    render(<TextField aria-label="未受控" defaultValue="默认" />)
    expect(screen.getByRole('textbox', { name: '未受控' })).toHaveValue('默认')
  })

  it('emits the complete value from textarea and select', async () => {
    const onText = vi.fn()
    const onSelect = vi.fn()
    render(
      <>
        <Textarea aria-label="简介" onValueChange={onText} />
        <Select aria-label="阶段" defaultValue="prompt" onValueChange={onSelect}>
          <option value="prompt">提示词</option>
          <option value="art">立绘</option>
        </Select>
      </>
    )
    await userEvent.type(screen.getByRole('textbox', { name: '简介' }), '黑发')
    expect(onText).toHaveBeenLastCalledWith('黑发')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '阶段' }), 'art')
    expect(onSelect).toHaveBeenLastCalledWith('art')
  })

  it('exposes switch state and supports search clearing', async () => {
    const ControlledSwitch: React.FC<EmptyProps> = () => {
      const [checked, setChecked] = useState(false)
      return <Switch aria-label="启用连接" checked={checked} onCheckedChange={setChecked} />
    }
    render(<ControlledSwitch />)
    const toggle = screen.getByRole('switch', { name: '启用连接' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    const onValueChange = vi.fn()
    render(
      <SearchField
        aria-label="搜索角色"
        clearLabel="清除搜索"
        defaultValue="凛"
        onValueChange={onValueChange}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: '清除搜索' }))
    expect(onValueChange).toHaveBeenLastCalledWith('')
  })

  it('reports dropped and selected files', async () => {
    const onFiles = vi.fn()
    render(
      <FileDropZone label="上传参考图" accept="image/png" onFiles={onFiles}>
        拖放或选择图片
      </FileDropZone>
    )
    const input = screen.getByLabelText('上传参考图') as HTMLInputElement
    const file = new File(['png'], 'reference.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onFiles).toHaveBeenCalledWith([file])
  })
})
