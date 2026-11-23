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
import { modelOptionLabel, providerDisplayName, providerModels } from '@studio/providers'
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
  Switch,
  TextField
} from '@agent2live/design-system'
import { MATERIAL_ROLE_LABELS } from '../../prompt-labels'
import { clampGenerationCount, generationCountOptions } from '../../generation-params'
import styles from './GenerationDialog.module.scss'

export interface GenerationDefaults {
  providerId?: string | null
  modelId?: string | null
  count?: number | null
  size?: string | null
  seed?: number | null
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left
  let b = right
  while (b !== 0) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a
}

function generationSizeLabel(value: string): string {
  if (/^(1K|1\.5K|2K|3K|4K)$/.test(value)) return `${value}（自动比例）`
  const match = /^(\d+)x(\d+)$/.exec(value)
  if (!match) return value
  const width = Number(match[1])
  const height = Number(match[2])
  const divisor = greatestCommonDivisor(width, height)
  return `${value}（${width / divisor}:${height / divisor}）`
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
  currentArtworkAssetId: string | null
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
  currentArtworkAssetId,
  providers,
  providersLoading,
  providersError,
  onClose,
  onCreated
}) => {
  const queryClient = useQueryClient()
  const imageProviders = useMemo(
    () => providers.filter((provider) => provider.enabled && providerModels(provider, 'image').length > 0),
    [providers]
  )
  const promptVersionId = initialPromptVersionId ?? ''
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [count, setCount] = useState(1)
  const [size, setSize] = useState('')
  const [seed, setSeed] = useState('')
  const [includeCurrentArtwork, setIncludeCurrentArtwork] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const selectedProvider =
    imageProviders.find((provider) => provider.id === providerId) ?? imageProviders[0] ?? null
  const imageModels = useMemo(
    () => (selectedProvider ? providerModels(selectedProvider, 'image') : []),
    [selectedProvider]
  )
  const selectedModel = imageModels.find((model) => model.id === modelId) ?? imageModels[0] ?? null
  const caps = selectedModel?.capabilities.image
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
    setIncludeCurrentArtwork(false)
    const nextProvider =
      imageProviders.find((provider) => provider.id === initialParams?.providerId) ??
      imageProviders[0] ??
      null
    const nextModels = nextProvider ? providerModels(nextProvider, 'image') : []
    const nextModel =
      nextModels.find((model) => model.id === initialParams?.modelId) ??
      nextModels.find((model) => model.id === nextProvider?.model) ??
      nextModels[0] ??
      null
    setProviderId(nextProvider?.id ?? '')
    setModelId(nextModel?.id ?? '')
    const nextCaps = nextModel?.capabilities.image
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
    initialParams?.modelId,
    initialParams?.count,
    initialParams?.size,
    initialParams?.seed
  ])

  useEffect(() => {
    if (!selectedProvider) return
    if (!imageModels.some((model) => model.id === modelId)) {
      setModelId(
        imageModels.find((model) => model.id === selectedProvider.model)?.id ?? imageModels[0]?.id ?? ''
      )
    }
  }, [selectedProvider?.id, imageModels, modelId])

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
  const promptReferenceCount = selectedPrompt?.references.length ?? 0
  const referenceLimit = Math.min(caps?.maxReferenceImages ?? 0, 14)
  const currentArtworkAlreadyReferenced = Boolean(
    currentArtworkAssetId &&
      selectedPrompt?.references.some((reference) => reference.assetId === currentArtworkAssetId)
  )
  const canIncludeCurrentArtwork =
    Boolean(currentArtworkAssetId) &&
    !currentArtworkAlreadyReferenced &&
    !promptQuery.isPending &&
    !promptQuery.isError &&
    promptReferenceCount < referenceLimit

  useEffect(() => {
    if (!canIncludeCurrentArtwork) setIncludeCurrentArtwork(false)
  }, [canIncludeCurrentArtwork])

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!promptVersionId) throw new Error('请先选择已保存的提示词版本。')
      if (!selectedProvider) throw new Error('没有可用的图像模型连接。')
      if (!selectedModel) throw new Error('没有可用的图片模型。')
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
        modelId: selectedModel.id,
        count,
        ...(size ? { size } : {}),
        ...(parsedSeed !== undefined ? { seed: parsedSeed } : {}),
        ...(includeCurrentArtwork && canIncludeCurrentArtwork ? { includeBaseArtworkReference: true } : {})
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
    promptVersionId !== '' &&
    !providersLoading &&
    providersError === null &&
    imageProviders.length > 0 &&
    selectedModel !== null

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
            disabled={!formReady || !selectedProvider || !selectedModel}
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
          description="在设置中保存包含生图模型的连接。"
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

          <Field label="供应商">
            <Select value={selectedProvider?.id ?? ''} onValueChange={setProviderId}>
              {imageProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {providerDisplayName(provider)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="图片模型">
            <Select
              data-testid="wb3-generation-model"
              value={selectedModel?.id ?? ''}
              onValueChange={setModelId}
            >
              {imageModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {modelOptionLabel(model)}
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

          <Field
            label="尺寸"
            description="2K/4K 是分辨率档位，宽高比由模型决定；需要固定比例请选择带比例的像素尺寸。"
          >
            <Select data-testid="wb3-generation-size" value={size} onValueChange={setSize}>
              {sizes.map((value) => (
                <option key={value} value={value}>
                  {generationSizeLabel(value)}
                </option>
              ))}
            </Select>
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

          <Field
            label={`参考图 取当前版本 ${promptReferenceCount} 张${
              includeCurrentArtwork && canIncludeCurrentArtwork ? ' + 当前立绘' : ''
            }`}
          >
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

          <Field label="当前立绘">
            {!currentArtworkAssetId ? (
              <p className={styles['wb3-overview-muted']!}>当前还没有立绘，本次只能使用提示词参考图。</p>
            ) : currentArtworkAlreadyReferenced ? (
              <p className={styles['wb3-overview-muted']!}>当前立绘已经在提示词参考图中，本次会直接使用。</p>
            ) : (
              <div className={styles['wb3-generation-current-art']!}>
                <ReferenceThumb assetId={currentArtworkAssetId} label="当前立绘" />
                <div className={styles['wb3-generation-current-copy']!}>
                  <span>将当前立绘作为参考图</span>
                  <p>
                    {promptReferenceCount >= referenceLimit
                      ? `参考图已达 ${referenceLimit} 张上限，请先减少提示词参考图。`
                      : '会作为身份参考一起发送，占用 1 张参考图额度。'}
                  </p>
                </div>
                <Switch
                  aria-label="将当前立绘作为参考图"
                  data-testid="wb3-generation-include-artwork"
                  checked={includeCurrentArtwork}
                  disabled={!canIncludeCurrentArtwork || createMutation.isPending}
                  onCheckedChange={setIncludeCurrentArtwork}
                />
              </div>
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
