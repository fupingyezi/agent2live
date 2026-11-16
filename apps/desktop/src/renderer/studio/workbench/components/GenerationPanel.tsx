import React, { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ArtProjectDto,
  ArtVersionMutationDto,
  GenerationCandidateDto,
  PromptWorkspaceDto
} from '@studio/api'
import { acceptGenerationCandidate, getGeneration, isTerminalJobStatus, queryKeys } from '@studio/api'
import { useJob } from '@studio/hooks'
import { formatDateTime, formatPercent } from '@studio/format'
import { CandidateCompare } from './CandidateCompare'
import { EmptyState, InlineNotice, SectionHeader, StatusPill } from '@agent2live/design-system'
import { StudioError } from '@studio/components'

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

export interface GenerationPanelProps {
  project: ArtProjectDto
  workspace: PromptWorkspaceDto
  preferredGenerationId?: string | null
  candidateSaveRequest?: number
  onAccepted: (mutation: ArtVersionMutationDto) => void
}

export const GenerationPanel: React.FC<GenerationPanelProps> = ({
  project,
  workspace,
  preferredGenerationId = null,
  candidateSaveRequest = 0,
  onAccepted
}) => {
  const queryClient = useQueryClient()
  const [generationId, setGenerationId] = useState<string | null>(
    () => preferredGenerationId ?? readStoredGeneration(project.id)
  )
  const [acceptingId, setAcceptingId] = useState<string | null>(null)

  useEffect(() => {
    setGenerationId(preferredGenerationId ?? readStoredGeneration(project.id))
  }, [preferredGenerationId, project.id])

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
  }, [generationQuery.refetch, job?.status])

  const acceptMutation = useMutation({
    mutationFn: (candidate: GenerationCandidateDto) =>
      acceptGenerationCandidate(candidate.id, project.activeVersionId),
    onMutate: (candidate) => setAcceptingId(candidate.id),
    onSuccess: async (mutation) => {
      onAccepted(mutation)
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
    },
    onSettled: () => setAcceptingId(null)
  })

  if (!workspace.activePromptVersion) {
    return (
      <div className="sidebar-panel">
        <EmptyState
          title="先生成提示词版本"
          description="生成任务必须绑定不可变 PromptVersion；提交草稿后即可生成立绘。"
        />
      </div>
    )
  }

  if (!generationId) {
    return (
      <div className="sidebar-panel" data-testid="generation-panel">
        <EmptyState
          title="还没有生成任务"
          description="从右侧角色描述栏打开“生成立绘”，设置只会出现在临时 Modal 中。"
        />
      </div>
    )
  }

  const queryError = generationQuery.error ?? jobQuery.error ?? acceptMutation.error

  return (
    <div className="sidebar-panel generation-panel" data-testid="generation-panel">
      {queryError ? (
        <StudioError
          error={queryError}
          onRetry={() => {
            void generationQuery.refetch()
            void jobQuery.refetch()
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
              <span className="job-progress">{formatPercent(job?.progress ?? generation.progress ?? 0)}</span>
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
              saveRequest={candidateSaveRequest}
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
