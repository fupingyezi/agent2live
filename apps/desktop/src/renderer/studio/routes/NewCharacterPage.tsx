import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AsyncButton,
  Button,
  Field,
  InlineNotice,
  PageHeader,
  SurfaceCard,
  Textarea,
  TextField,
  type EmptyProps
} from '@agent2live/design-system'
import { ApiError } from '@studio/api'
import { queryKeys } from '@studio/api'
import { createCharacter } from '@studio/api'
import type { CreateCharacterInput } from '@studio/api'

export const NewCharacterPage: React.FC<EmptyProps> = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (input: CreateCharacterInput) => createCharacter(input),
    onSuccess: (character) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.characters })
      navigate(`/characters/${encodeURIComponent(character.id)}`)
    }
  })

  const clearFailure = (): void => {
    setLocalError(null)
    if (mutation.isError) mutation.reset()
  }

  const onSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setLocalError('请输入角色名称。')
      return
    }
    if (cleanTitle.length > 100) {
      setLocalError('角色名称不能超过 100 个字符。')
      return
    }
    if (summary.trim().length > 2000) {
      setLocalError('角色简介不能超过 2000 个字符。')
      return
    }
    setLocalError(null)
    const cleanSummary = summary.trim()
    mutation.mutate(cleanSummary ? { title: cleanTitle, summary: cleanSummary } : { title: cleanTitle })
  }

  const serverError = mutation.error instanceof ApiError ? mutation.error.message : null
  const errorCode = mutation.error instanceof ApiError ? mutation.error.code : null

  return (
    <div className="studio-page studio-page-narrow">
      <PageHeader
        back={
          <Link className="studio-back" to="/">
            ← 返回角色
          </Link>
        }
        eyebrow="新角色"
        title="建立一个角色母体"
        description="母体承载角色身份；美术分支在驾驶舱里创建。"
      />

      <SurfaceCard title="角色信息" description="只需要一个清晰的名字，简介可以稍后补充。">
        <form className="studio-form" onSubmit={onSubmit} noValidate>
          <Field id="character-title" label="角色名称" required>
            <TextField
              id="character-title"
              value={title}
              maxLength={100}
              autoFocus
              placeholder="例如：凛"
              onValueChange={(value) => {
                setTitle(value)
                clearFailure()
              }}
            />
          </Field>

          <Field id="character-summary" label="角色简介（可选）">
            <Textarea
              id="character-summary"
              value={summary}
              maxLength={2000}
              rows={5}
              placeholder="外观、气质、世界观线索；不要填写密钥或隐私内容。"
              onValueChange={(value) => {
                setSummary(value)
                clearFailure()
              }}
            />
          </Field>

          {localError ? (
            <InlineNotice tone="danger">
              <span role="alert">{localError}</span>
            </InlineNotice>
          ) : null}
          {serverError ? (
            <InlineNotice tone="danger">
              <p role="alert">{serverError}</p>
              {errorCode ? (
                <p className="studio-meta">
                  错误码：<code>{errorCode}</code>
                </p>
              ) : null}
            </InlineNotice>
          ) : null}

          <div className="studio-form-actions">
            <Button asChild variant="quiet">
              <Link to="/">取消</Link>
            </Button>
            <AsyncButton type="submit" busy={mutation.isPending} busyLabel="创建中…">
              创建角色
            </AsyncButton>
          </div>
        </form>
      </SurfaceCard>
    </div>
  )
}
