import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ArtProjectDto,
  ArtVersionMutationDto,
  GenerationCandidateDto,
  PromptWorkspaceDto,
  ProviderConnectionDto
} from '../../api/types'
import {
  acceptGenerationCandidate,
  createGeneration,
  getGeneration,
  isTerminalJobStatus
} from '../../api/queries'
import { queryKeys } from '../../api/keys'
import { ApiError } from '../../api/client'
import { useJob } from '../../hooks/useJob'
import { formatDateTime } from '../../format'
import { CandidateCompare } from './CandidateCompare'
import {
  AsyncButton,
  EmptyState,
  Field,
  InlineNotice,
  SectionHeader,
  Select,
  StatusPill,
  TextField
} from '@agent2live/design-system'
import { StudioError } from '../../components/StudioError'

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

function readStoredGeneration(projectId: string): string | null {
  try {
    return window.localStorage.getItem(generationStorageKey(projectId))
  } catch {
    return null
  }
}

function storeGeneration(projectId: string, generationId: string): void {
  try {
    window.localStorage.setItem(generationStorageKey(projectId), generationId)
  } catch {
    // localStorage 不可用时仅丢失刷新后的恢复能力，不影响任务本身。
  }
}

export interface GenerationPanelProps {
  project: ArtProjectDto
  workspace: PromptWorkspaceDto
  providers: ProviderConnectionDto[]
  onAccepted: (mutation: ArtVersionMutationDto) => void
}

export const GenerationPanel: React.FC<GenerationPanelProps> = ({
  project,
  workspace,
  providers,
  onAccepted
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
  const [generationId, setGenerationId] = useState<string | null>(() => readStoredGeneration(project.id))
  const [localError, setLocalError] = useState<string | null>(null)
  const [acceptingId, setAcceptingId] = useState<string | null>(null)

  useEffect(() => {
    setGenerationId(readStoredGeneration(project.id))
  }, [project.id])

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
  }, [sizes, size])

  const generationQuery = useQuery({
    queryKey: queryKeys.generation(project.id, generationId ?? 'none'),
    queryFn: ({ signal }) => getGeneration(generationId!, signal),
    enabled: Boolean(generationId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && isTerminalJobStatus(status) ? false : 1500
    }
  })
  const generation = generationQuery.data ?? null
  const jobQuery = useJob(generation?.jobId ?? null)
  const job = jobQuery.data ?? null

  useEffect(() => {
    if (job && (job.status === 'succeeded' || job.status === 'failed')) {
      void generationQuery.refetch()
    }
  }, [job?.status, generationQuery.refetch])

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
      setGenerationId(created.generationId)
      storeGeneration(project.id, created.generationId)
      void queryClient.invalidateQueries({ queryKey: queryKeys.generation(project.id, created.generationId) })
    },
    onError: (error) => {
      setLocalError(
        error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error)
      )
    }
  })

  const acceptMutation = useMutation({
    mutationFn: (candidate: GenerationCandidateDto) =>
      acceptGenerationCandidate(candidate.id, project.activeVersionId),
    onMutate: (candidate) => setAcceptingId(candidate.id),
    onSuccess: async (mutation) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.artVersions(project.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workspace(project.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.lineages }),
        queryClient.invalidateQueries({ queryKey: queryKeys.characters })
      ])
      if (generationId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.generation(project.id, generationId) })
      }
      onAccepted(mutation)
    },
    onSettled: () => setAcceptingId(null)
  })

  if (!workspace.activePromptVersion) {
    return (
      <div className="sidebar-panel">
        <EmptyState
          title="先生成提示词版本"
          description="生成任务必须绑定不可变 PromptVersion；提交草稿后即可选择图像模型。"
        />
      </div>
    )
  }

  if (imageProviders.length === 0) {
    return (
      <div className="sidebar-panel">
        <EmptyState
          title="没有可用的图像模型"
          description="在设置中添加 Seedream 或 OpenAI-compatible 图像连接，并启用它。"
        />
      </div>
    )
  }

  const queryError = generationQuery.error ?? jobQuery.error ?? acceptMutation.error

  return (
    <div className="sidebar-panel generation-panel" data-testid="generation-panel">
      <SectionHeader
        title="生成候选"
        description="立绘"
        actions={
          <StatusPill label={`提示词 v${workspace.activePromptVersion.versionNumber}`} tone="accent" />
        }
      />

      <div className="generation-form">
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
        {localError ? (
          <div role="alert">
            <InlineNotice tone="danger">{localError}</InlineNotice>
          </div>
        ) : null}
        <AsyncButton
          type="button"
          busy={createMutation.isPending}
          busyLabel="提交生成…"
          disabled={!selectedProvider}
          onClick={() => createMutation.mutate()}
        >
          开始生成
        </AsyncButton>
        {generation?.baseArtVersionId ? (
          <p className="muted">会使用当前 active ArtVersion 作为主参考。</p>
        ) : (
          <p className="muted">还没有 active ArtVersion；本次只使用提示词与素材。</p>
        )}
      </div>

      {queryError ? (
        <StudioError
          error={queryError}
          onRetry={() => {
            generationQuery.refetch()
            jobQuery.refetch()
            acceptMutation.reset()
          }}
        />
      ) : null}

      {generation ? (
        <div className="generation-status" data-testid="generation-status">
          <SectionHeader title="生成状态" />
          <div className="job-banner">
            <StatusPill
              label={job?.status ?? generation.status}
              tone={
                (job?.status ?? generation.status) === 'failed'
                  ? 'danger'
                  : (job?.status ?? generation.status) === 'succeeded'
                    ? 'success'
                    : 'accent'
              }
            />
            <code title={generation.id}>{generation.id}</code>
            {(job?.progress ?? generation.progress) !== null ? (
              <span className="job-progress">
                {Math.round((job?.progress ?? generation.progress ?? 0) * 100)}%
              </span>
            ) : null}
          </div>
          <p className="muted">
            提交于 {formatDateTime(generation.createdAt)} · job {generation.jobId}
          </p>
          {(generation.errorCode ?? job?.errorCode) ? (
            <div role="alert">
              <InlineNotice tone="danger">生成失败：{generation.errorCode ?? job?.errorCode}</InlineNotice>
            </div>
          ) : null}
          {job?.status === 'succeeded' || generation.status === 'succeeded' ? (
            <CandidateCompare
              candidates={generation.candidates}
              acceptingId={acceptingId}
              onAccept={(candidate) => acceptMutation.mutate(candidate)}
            />
          ) : (
            <p className="muted">任务完成后候选会显示在这里；未完成前不显示占位图或伪造进度。</p>
          )}
        </div>
      ) : null}
    </div>
  )
}
