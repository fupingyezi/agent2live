import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ArtProjectDto } from '@studio/api'
import {
  getGeneration,
  getPromptVersion,
  getPromptWorkspace,
  listArtVersions,
  listGenerations,
  listProviders,
  queryKeys
} from '@studio/api'
import { connectionDisplayName, findDefaultTextSelection } from '@studio/providers'
import type { WorkbenchViewState } from '../view-state'
import { errorMessage, TERMINAL_GENERATION_STATUSES } from '../workbench-helpers'

export function useWorkbenchData(project: ArtProjectDto, viewState: WorkbenchViewState) {
  const workspaceQuery = useQuery({
    queryKey: queryKeys.workspace(project.id),
    queryFn: ({ signal }) => getPromptWorkspace(project.id, signal)
  })
  const providersQuery = useQuery({
    queryKey: queryKeys.providers,
    queryFn: ({ signal }) => listProviders(signal)
  })
  const versionsQuery = useQuery({
    queryKey: queryKeys.artVersions(project.id),
    queryFn: ({ signal }) => listArtVersions(project.id, signal)
  })
  const generationsQuery = useQuery({
    queryKey: queryKeys.generations(project.id),
    queryFn: ({ signal }) => listGenerations(project.id, 20, signal)
  })
  const generationDetailQuery = useQuery({
    queryKey: queryKeys.generation(project.id, viewState.generationId ?? 'none'),
    queryFn: ({ signal }) => getGeneration(viewState.generationId!, signal),
    enabled: Boolean(viewState.generationId) && viewState.view === 'candidates',
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && TERMINAL_GENERATION_STATUSES.has(status) ? false : 1500
    }
  })

  const workspace = workspaceQuery.data ?? null
  const generationDetail =
    generationDetailQuery.data && generationDetailQuery.data.artProjectId === project.id
      ? generationDetailQuery.data
      : null
  const artVersions = versionsQuery.data ?? []
  const currentArtVersion = artVersions.find((version) => version.id === project.activeVersionId) ?? null
  const artPromptVersionQuery = useQuery({
    queryKey: queryKeys.promptVersion(project.id, currentArtVersion?.promptVersionId ?? 'none'),
    queryFn: ({ signal }) => getPromptVersion(project.id, currentArtVersion!.promptVersionId, signal),
    enabled: Boolean(currentArtVersion)
  })
  const providers = providersQuery.data ?? []

  const candidateGeneration = useMemo(() => {
    if (generationDetail) return generationDetail
    const items = generationsQuery.data ?? []
    if (viewState.generationId) {
      const listed = items.find((generation) => generation.id === viewState.generationId)
      if (listed) return listed
      if (generationDetailQuery.isPending || generationDetailQuery.isFetching) return null
    }
    return items[0] ?? null
  }, [
    generationDetail,
    generationDetailQuery.isFetching,
    generationDetailQuery.isPending,
    generationsQuery.data,
    viewState.generationId
  ])
  const candidateBaseVersion =
    artVersions.find((version) => version.id === candidateGeneration?.baseArtVersionId) ?? null
  const candidateGenerationLoading =
    candidateGeneration === null &&
    (generationsQuery.isPending || (Boolean(viewState.generationId) && generationDetailQuery.isPending))

  const candidateConnection = providers.find(
    (connection) => connection.id === candidateGeneration?.providerConnectionId
  )
  const providerLabel = candidateGeneration
    ? `${candidateConnection ? connectionDisplayName(candidateConnection) : '未指定'} · ${candidateGeneration.modelId ?? '默认模型'}`
    : '未指定'
  const defaultTextSelection = findDefaultTextSelection(providers)
  const defaultTextLabel = defaultTextSelection
    ? `${connectionDisplayName(defaultTextSelection.connection)} · ${defaultTextSelection.model.name ?? defaultTextSelection.model.id}`
    : '未配置文字模型'

  const promptVersionNumberForGeneration = useMemo(() => {
    const versionId = candidateGeneration?.promptVersionId
    if (!versionId) return null
    return (
      workspace?.versions.find((version) => version.id === versionId)?.versionNumber ??
      (workspace?.activePromptVersion?.id === versionId ? workspace.activePromptVersion.versionNumber : null)
    )
  }, [candidateGeneration?.promptVersionId, workspace?.versions, workspace?.activePromptVersion])

  const selectedPromptVersionId = viewState.promptVersionId ?? workspace?.activePromptVersion?.id ?? null
  const latestGeneration = useMemo(() => {
    const items = generationsQuery.data ?? []
    return (
      items.find(
        (generation) =>
          generation.promptVersionId === selectedPromptVersionId && generation.status === 'succeeded'
      ) ?? null
    )
  }, [generationsQuery.data, selectedPromptVersionId])
  const promptVersionQuery = useQuery({
    queryKey: queryKeys.promptVersion(project.id, selectedPromptVersionId ?? 'none'),
    queryFn: ({ signal }) => getPromptVersion(project.id, selectedPromptVersionId!, signal),
    enabled: Boolean(selectedPromptVersionId)
  })
  const selectedPromptVersion =
    promptVersionQuery.data ??
    (workspace && selectedPromptVersionId === workspace.activePromptVersion?.id
      ? (workspace.activePromptVersion ?? null)
      : null)
  const promptVersionError = promptVersionQuery.isError
    ? (errorMessage(promptVersionQuery.error) ?? '提示词版本加载失败。')
    : null

  return {
    workspaceQuery,
    providersQuery,
    versionsQuery,
    generationsQuery,
    generationDetailQuery,
    artPromptVersionQuery,
    workspace,
    generationDetail,
    providers,
    artVersions,
    currentArtVersion,
    candidateGeneration,
    candidateBaseVersion,
    candidateGenerationLoading,
    providerLabel,
    defaultTextLabel,
    promptVersionNumberForGeneration,
    selectedPromptVersionId,
    latestGeneration,
    selectedPromptVersion,
    promptVersionError
  }
}
