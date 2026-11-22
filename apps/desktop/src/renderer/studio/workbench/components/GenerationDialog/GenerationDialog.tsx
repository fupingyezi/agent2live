import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ArtProjectDto,
  CreateGenerationResultDto,
  PromptVersionSummaryDto,
  ProviderConnectionDto
} from '@studio/api'
import { ApiError, createGeneration, getPromptVersion, queryKeys } from '@studio/api'
import { useAssetUrl } from '@studio/hooks'
import {
  AsyncButton,
  Button,
  ChipGroup,
  Dialog,
  EmptyState,
  Field,
  InlineNotice,
  Select,
  StatusPill,
  TextField
} from '@agent2live/design-system'
import { MATERIAL_ROLE_LABELS } from '../../prompt-labels'
import { clampGenerationCount, generationCountOptions } from '../../generation-params'
import styles from './GenerationDialog.module.scss'

interface ImageCapabilities {
  image?: { sizes?: string[]; maxCount?: number; supportsSeed?: boolean }
}

export interface GenerationDefaults {
  providerId?: string | null
  count?: number | null
  size?: string | null
  seed?: number | null
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

interface ReferenceThumbProps {
  assetId: string
  label: string
}

const ReferenceThumb: React.FC<ReferenceThumbProps> = ({ assetId, label }) => {
  const { url } = useAssetUrl(assetId)
  return (
    <span className={styles['wb3-generation-reference']!} title={label}>
      {url ? <img src={url} alt={`${label}参考图`} /> : <span aria-hidden="true" />}
    </span>
  )
}

export interface GenerationDialogProps {
  open: boolean
  project: ArtProjectDto
  promptVersions: PromptVersionSummaryDto[]
  initialPromptVersionId: string | null
  initialPromptVersionNumber: number | null
  initialParams?: GenerationDefaults | null
  providers: ProviderConnectionDto[]
  providersLoading: boolean
  providersError: string | null
  onClose(): void
  onCreated(created: CreateGenerationResultDto): void
}

export const GenerationDialog: React.FC<GenerationDialogProps> = ({
  open,
  project,
  promptVersions,
  initialPromptVersionId,
  initialPromptVersionNumber,
  initialParams = null,
  providers,
  providersLoading,
  providersError,
  onClose,
  onCreated
}) => {
  const queryClient = useQueryClient()
  const imageProviders = useMemo(
    () => providers.filter((provider) => provider.enabled && provider.kind === 'image'),
    [providers]
  )
  const promptVersionId = initialPromptVersionId ?? ''
  const [providerId, setProviderId] = useState('')
  const [count, setCount] = useState(1)
  const [size, setSize] = useState('')
  const [seed, setSeed] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const selectedProvider =
    imageProviders.find((provider) => provider.id === providerId) ?? imageProviders[0] ?? null
  const caps = selectedProvider ? imageCapabilities(selectedProvider) : undefined
  const sizes = caps?.sizes ?? []
  const seedSupported = caps?.supportsSeed !== false
  const maxCount = Math.min(8, caps?.maxCount ?? 1)
  const countOptions = useMemo(
    () => generationCountOptions(maxCount, initialParams?.count),
    [maxCount, initialParams?.count]
  )

  useEffect(() => {
    if (!open) return
    setLocalError(null)
    const nextProvider =
      imageProviders.find((provider) => provider.id === initialParams?.providerId) ??
      imageProviders[0] ??
      null
    setProviderId(nextProvider?.id ?? '')
    const nextCaps = nextProvider ? imageCapabilities(nextProvider) : undefined
    const nextMax = Math.min(8, nextCaps?.maxCount ?? 1)
    setCount(clampGenerationCount(initialParams?.count, nextMax))
    setSize(initialParams?.size ?? nextCaps?.sizes?.[0] ?? '')
    const nextSeedSupported = nextCaps?.supportsSeed !== false
    setSeed(
      nextSeedSupported && initialParams?.seed !== null && initialParams?.seed !== undefined
        ? String(initialParams.seed)
        : ''
    )
  }, [
    open,
    providersLoading,
    initialParams?.providerId,
    initialParams?.count,
    initialParams?.size,
    initialParams?.seed
  ])

  useEffect(() => {
    setCount((current) => clampGenerationCount(current, maxCount))
  }, [maxCount])

  useEffect(() => {
    if (!seedSupported && seed !== '') setSeed('')
  }, [seedSupported, seed])

  useEffect(() => {
    if (sizes.length > 0 && !sizes.includes(size)) setSize(sizes[0]!)
  }, [sizes, size])

  const promptQuery = useQuery({
    queryKey: queryKeys.promptVersion(project.id, promptVersionId || 'none'),
    queryFn: ({ signal }) => getPromptVersion(project.id, promptVersionId, signal),
    enabled: open && promptVersionId !== ''
  })
  const selectedPrompt = promptQuery.data ?? null
  const promptVersionNumber =
    selectedPrompt?.versionNumber ??
    promptVersions.find((version) => version.id === promptVersionId)?.versionNumber ??
    initialPromptVersionNumber

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!promptVersionId) throw new Error('请先选择已保存的提示词版本。')
      if (!selectedProvider) throw new Error('没有可用的图像模型连接。')
      let parsedSeed: number | null | undefined
      if (seedSupported && seed.trim()) {
        const value = Number(seed)
        if (!Number.isInteger(value) || value < 0 || value > 2_147_483_647) {
          throw new Error('种子必须是 0 到 2147483647 的整数。')
        }
        parsedSeed = value
      }
      return createGeneration(project.id, {
        promptVersionId,
        providerConnectionId: selectedProvider.id,
        count,
        ...(size ? { size } : {}),
        ...(parsedSeed !== undefined ? { seed: parsedSeed } : {})
      })
    },
    onMutate: () => setLocalError(null),
    onSuccess: (created) => {
      storeGeneration(project.id, created.generationId)
      void queryClient.invalidateQueries({ queryKey: queryKeys.generations(project.id) })
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

  const formReady =
    promptVersionId !== '' && !providersLoading && providersError === null && imageProviders.length > 0

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !createMutation.isPending) onClose()
      }}
      title="生成图片"
      description="配置参数，一张图片约一分钟"
      busy={createMutation.isPending}
      className={styles['wb3-generation-dialog']!}
      footer={
        <>
          <span className={styles['wb3-dialog-spacer']!} />
          <Button variant="quiet" disabled={createMutation.isPending} onClick={onClose}>
            取消
          </Button>
          <AsyncButton
            variant="primary"
            busy={createMutation.isPending}
            busyLabel="提交生成…"
            disabled={!formReady || !selectedProvider}
            onClick={() => createMutation.mutate()}
          >
            生成图片
          </AsyncButton>
        </>
      }
    >
      {!promptVersionId ? (
        <EmptyState title="还没有提示词版本" description="先提交一版提示词，再生成图片。" />
      ) : providersLoading ? (
        <EmptyState title="正在加载图像模型" description="正在读取已启用的 Provider 连接。" />
      ) : providersError ? (
        <div role="alert">
          <InlineNotice tone="danger">{providersError}</InlineNotice>
        </div>
      ) : imageProviders.length === 0 ? (
        <EmptyState
          title="没有可用的图像模型"
          description="在设置中添加 Seedream 或兼容图像连接，并启用它。"
          action={
            <Button asChild variant="secondary">
              <Link to="/settings/providers">去设置</Link>
            </Button>
          }
        />
      ) : (
        <div className={styles['wb3-dialog-stack']!} data-testid="wb3-generation-dialog">
          <section className={styles['wb3-generation-prompt']!}>
            <div>
              <span>提示词版本</span>
              <strong>第 {promptVersionNumber ?? '—'} 版</strong>
            </div>
            <div className={styles['wb3-generation-prompt-meta']!}>
              {selectedPrompt ? (
                <StatusPill
                  label={`${selectedPrompt.state.blocks.length + selectedPrompt.state.negativeBlocks.length} 条目 · ${selectedPrompt.references.length} 张参考图`}
                  tone="accent"
                />
              ) : null}
            </div>
          </section>

          <Field label="图片模型">
            <Select value={selectedProvider?.id ?? ''} onValueChange={setProviderId}>
              {imageProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="张数">
            <ChipGroup
              ariaLabel="生成张数"
              value={String(count)}
              onValueChange={(value) => setCount(Number(value))}
              options={countOptions.map((value) => ({ id: String(value), label: `${value} 张` }))}
            />
          </Field>

          <Field label="尺寸">
            <ChipGroup
              ariaLabel="生成尺寸"
              value={size}
              onValueChange={setSize}
              options={sizes.map((value) => ({ id: value, label: value }))}
            />
          </Field>

          {seedSupported ? (
            <Field label="种子">
              <div className={styles['wb3-seed-row']!}>
                <TextField
                  aria-label="种子"
                  inputMode="numeric"
                  value={seed}
                  placeholder="留空则每次随机"
                  onValueChange={(value) => setSeed(value.replace(/[^0-9]/g, ''))}
                />
                <Button variant="secondary" size="sm" onClick={() => setSeed('')}>
                  随机
                </Button>
              </div>
            </Field>
          ) : null}

          <Field label={`参考图 取当前版本 ${selectedPrompt?.references.length ?? 0} 张`}>
            {promptQuery.isPending ? (
              <p className={styles['wb3-overview-muted']!}>正在加载参考图…</p>
            ) : promptQuery.isError ? null : selectedPrompt && selectedPrompt.references.length > 0 ? (
              <div className={styles['wb3-generation-references']!}>
                {selectedPrompt.references.map((reference) => (
                  <ReferenceThumb
                    key={reference.assetId}
                    assetId={reference.assetId}
                    label={MATERIAL_ROLE_LABELS[reference.role]}
                  />
                ))}
              </div>
            ) : (
              <p className={styles['wb3-overview-muted']!}>该版本没有参考图，本次按文生图生成。</p>
            )}
          </Field>

          {promptQuery.isError ? (
            <InlineNotice tone="danger">提示词版本加载失败，请关闭后重试。</InlineNotice>
          ) : null}
          {localError ? (
            <div role="alert">
              <InlineNotice tone="danger">{localError}</InlineNotice>
            </div>
          ) : null}
        </div>
      )}
    </Dialog>
  )
}
