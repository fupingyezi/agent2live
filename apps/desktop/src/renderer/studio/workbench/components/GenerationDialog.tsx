import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  ArtProjectDto,
  CreateGenerationResultDto,
  PromptWorkspaceDto,
  ProviderConnectionDto
} from '@studio/api'
import { ApiError, createGeneration, queryKeys } from '@studio/api'
import {
  AsyncButton,
  Button,
  Dialog,
  EmptyState,
  Field,
  InlineNotice,
  Select,
  TextField
} from '@agent2live/design-system'

interface ImageCapabilities {
  image?: { sizes?: string[]; maxCount?: number; supportsSeed?: boolean }
}

function imageCapabilities(provider: ProviderConnectionDto): ImageCapabilities['image'] | undefined {
  if (!provider.capabilities || typeof provider.capabilities !== 'object') return undefined
  return (provider.capabilities as ImageCapabilities).image
}

function generationStorageKey(projectId: string): string {
  return `agent2live:last-generation:${projectId}`
}

function storeGeneration(projectId: string, generationId: string): void {
  try {
    window.localStorage.setItem(generationStorageKey(projectId), generationId)
  } catch {
    // localStorage 不可用时只影响刷新后的恢复，不影响本次生成。
  }
}

export interface GenerationDialogProps {
  open: boolean
  project: ArtProjectDto
  workspace: PromptWorkspaceDto
  providers: ProviderConnectionDto[]
  onClose(): void
  onCreated(created: CreateGenerationResultDto): void
}

export const GenerationDialog: React.FC<GenerationDialogProps> = ({
  open,
  project,
  workspace,
  providers,
  onClose,
  onCreated
}) => {
  const queryClient = useQueryClient()
  const imageProviders = useMemo(
    () => providers.filter((provider) => provider.enabled && provider.kind === 'image'),
    [providers]
  )
  const [providerId, setProviderId] = useState('')
  const [count, setCount] = useState(1)
  const [size, setSize] = useState('')
  const [seed, setSeed] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (!providerId && imageProviders[0]) setProviderId(imageProviders[0].id)
  }, [providerId, imageProviders])

  const selectedProvider =
    imageProviders.find((provider) => provider.id === providerId) ?? imageProviders[0] ?? null
  const caps = selectedProvider ? imageCapabilities(selectedProvider) : undefined
  const sizes = caps?.sizes ?? []
  const maxCount = Math.min(4, caps?.maxCount ?? 1)

  useEffect(() => {
    if (count > maxCount) setCount(maxCount)
  }, [count, maxCount])

  useEffect(() => {
    const firstSize = sizes[0]
    if (firstSize !== undefined && !sizes.includes(size)) setSize(firstSize)
  }, [size, sizes])

  useEffect(() => {
    if (open) setLocalError(null)
  }, [open])

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!workspace.activePromptVersion) throw new Error('先提交一个提示词版本。')
      if (!selectedProvider) throw new Error('没有可用的图像模型连接。')
      let parsedSeed: number | null | undefined
      if (seed.trim()) {
        const value = Number(seed)
        if (!Number.isInteger(value) || value < 0 || value > 2_147_483_647) {
          throw new Error('seed 必须是 0 到 2147483647 的整数。')
        }
        parsedSeed = value
      }
      return createGeneration(project.id, {
        promptVersionId: workspace.activePromptVersion.id,
        providerConnectionId: selectedProvider.id,
        count,
        ...(size ? { size } : {}),
        ...(parsedSeed !== undefined ? { seed: parsedSeed } : {})
      })
    },
    onMutate: () => setLocalError(null),
    onSuccess: (created) => {
      storeGeneration(project.id, created.generationId)
      void queryClient.invalidateQueries({
        queryKey: queryKeys.generation(project.id, created.generationId)
      })
      onCreated(created)
      onClose()
    },
    onError: (error) => {
      setLocalError(
        error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error)
      )
    }
  })

  return (
    <Dialog
      open={open}
      title="生成立绘"
      description="设置只用于本次生成，不会占用画布。"
      onOpenChange={(next) => {
        if (!next && !createMutation.isPending) onClose()
      }}
      className="generation-dialog"
    >
      {!workspace.activePromptVersion ? (
        <EmptyState
          title="先生成提示词版本"
          description="生成任务必须绑定不可变 PromptVersion；提交草稿后即可选择图像模型。"
        />
      ) : imageProviders.length === 0 ? (
        <EmptyState
          title="没有可用的图像模型"
          description="在设置中添加 Seedream 或兼容图像连接，并启用它。"
        />
      ) : (
        <div className="generation-dialog-content" data-testid="generation-dialog">
          <div className="generation-form" data-testid="generation-settings">
            <Field label="图像模型">
              <Select value={selectedProvider?.id ?? ''} onValueChange={setProviderId}>
                {imageProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="generation-row">
              <Field label="数量">
                <Select value={String(count)} onValueChange={(value) => setCount(Number(value))}>
                  {Array.from({ length: maxCount }, (_, index) => index + 1).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </Field>
              {sizes.length > 0 ? (
                <Field label="尺寸">
                  <Select value={size} onValueChange={setSize}>
                    {sizes.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              {caps?.supportsSeed ? (
                <Field label="Seed" description="可选">
                  <TextField
                    inputMode="numeric"
                    value={seed}
                    placeholder="随机"
                    onValueChange={(value) => setSeed(value.replace(/[^0-9]/g, ''))}
                  />
                </Field>
              ) : null}
            </div>
          </div>
          <p className="muted">
            {project.activeVersionId
              ? '本次会使用当前 active ArtVersion 作为主参考。'
              : '当前还没有 active ArtVersion；本次只使用提示词与素材。'}
          </p>
          {localError ? (
            <div role="alert">
              <InlineNotice tone="danger">{localError}</InlineNotice>
            </div>
          ) : null}
          <div className="generation-dialog-actions">
            <Button type="button" variant="quiet" disabled={createMutation.isPending} onClick={onClose}>
              取消
            </Button>
            <AsyncButton
              type="button"
              busy={createMutation.isPending}
              busyLabel="提交生成…"
              disabled={!selectedProvider}
              onClick={() => createMutation.mutate()}
            >
              开始生成
            </AsyncButton>
          </div>
        </div>
      )}
    </Dialog>
  )
}
