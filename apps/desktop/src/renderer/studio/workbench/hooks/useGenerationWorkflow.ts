import { useEffect, useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type { ArtProjectDto, CreateGenerationResultDto, GenerationDto, PromptVersionDto } from '@studio/api'
import { acceptGenerationCandidate, discardGeneration, queryKeys } from '@studio/api'
import type { GenerationDefaults } from '../components/generation/GenerationDialog'
import type { WorkbenchViewState } from '../view-state'
import { errorMessage, TERMINAL_GENERATION_STATUSES } from '../workbench-helpers'

export interface UseGenerationWorkflowOptions {
  project: ArtProjectDto
  queryClient: QueryClient
  setView: (patch: Partial<WorkbenchViewState>) => void
  candidateGeneration: GenerationDto | null
  generationDetail: GenerationDto | null
  promptVersionNumberForGeneration: number | null
  selectedPromptVersion: PromptVersionDto | null
  saveCurrentVersion: () => Promise<{ id: string; versionNumber: number; created: boolean }>
  setVersionError: (message: string | null) => void
}

export function useGenerationWorkflow({
  project,
  queryClient,
  setView,
  candidateGeneration,
  generationDetail,
  promptVersionNumberForGeneration,
  selectedPromptVersion,
  saveCurrentVersion,
  setVersionError
}: UseGenerationWorkflowOptions) {
  const [generationDialogOpen, setGenerationDialogOpen] = useState(false)
  const [generationDefaults, setGenerationDefaults] = useState<GenerationDefaults | null>(null)
  const [generationPromptVersion, setGenerationPromptVersion] = useState<{
    id: string
    versionNumber: number
  } | null>(null)
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [savingCandidateId, setSavingCandidateId] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState(false)

  useEffect(() => {
    if (!candidateGeneration) {
      setSelectedCandidateId(null)
      return
    }
    const ready = candidateGeneration.candidates.filter((candidate) => candidate.status === 'ready')
    setSelectedCandidateId((current) =>
      current && ready.some((candidate) => candidate.id === current) ? current : (ready[0]?.id ?? null)
    )
  }, [candidateGeneration?.id, candidateGeneration?.candidates.length])

  useEffect(() => {
    const status = generationDetail?.status
    if (!status || !TERMINAL_GENERATION_STATUSES.has(status)) return
    void queryClient.invalidateQueries({ queryKey: queryKeys.generations(project.id) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.artVersions(project.id) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) })
  }, [generationDetail?.id, generationDetail?.status, project.id, queryClient])

  const openGenerationDialog = async (): Promise<{
    versionNumber: number
    created: boolean
  }> => {
    if (!selectedPromptVersion) throw new Error('请先选择提示词版本。')
    const version = await saveCurrentVersion()
    setGenerationPromptVersion({
      id: version.id,
      versionNumber: version.versionNumber
    })
    setGenerationDefaults(null)
    setGenerationDialogOpen(true)
    return version
  }

  const regenerate = (): void => {
    void openGenerationDialog().catch((reason) => setVersionError(errorMessage(reason)))
  }

  const openCandidateGenerationDialog = (overrides?: Partial<GenerationDefaults>): void => {
    if (!candidateGeneration) return
    setGenerationPromptVersion({
      id: candidateGeneration.promptVersionId,
      versionNumber: promptVersionNumberForGeneration ?? 0
    })
    setGenerationDefaults({
      providerId: candidateGeneration.providerConnectionId,
      modelId: candidateGeneration.modelId,
      count: overrides?.count ?? candidateGeneration.count,
      size: overrides?.size ?? candidateGeneration.size,
      seed: overrides?.seed ?? candidateGeneration.seed
    })
    setGenerationDialogOpen(true)
  }

  const closeGenerationDialog = (): void => {
    setGenerationDialogOpen(false)
    setGenerationPromptVersion(null)
    setGenerationDefaults(null)
  }

  const handleGenerationCreated = (created: CreateGenerationResultDto): void => {
    closeGenerationDialog()
    setView({ view: 'candidates', generationId: created.generationId })
  }

  const saveCandidate = (candidateId: string): void => {
    setSavingCandidateId(candidateId)
    setVersionError(null)
    acceptGenerationCandidate(candidateId, project.activeVersionId)
      .then((mutation) => {
        queryClient.setQueryData(queryKeys.project(project.id), mutation.artProject)
        setView({ view: 'versions', artVersionId: mutation.artVersion.id })
        if (candidateGeneration) {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.generation(project.id, candidateGeneration.id)
          })
        }
        return Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.artVersions(project.id) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.workspace(project.id) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.generations(project.id) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.lineages }),
          queryClient.invalidateQueries({ queryKey: queryKeys.characters })
        ])
      })
      .catch((reason) => setVersionError(errorMessage(reason)))
      .finally(() => setSavingCandidateId(null))
  }

  const discardBatch = (): void => {
    if (!candidateGeneration) return
    setDiscarding(true)
    setVersionError(null)
    discardGeneration(candidateGeneration.id)
      .then(() => {
        setView({ view: 'prompt', promptVersionId: null })
        return Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.generations(project.id) }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.generation(project.id, candidateGeneration.id)
          })
        ])
      })
      .catch((reason) => setVersionError(errorMessage(reason)))
      .finally(() => setDiscarding(false))
  }

  return {
    generationDialogOpen,
    generationDefaults,
    generationPromptVersion,
    selectedCandidateId,
    setSelectedCandidateId,
    savingCandidateId,
    discarding,
    regenerate,
    openCandidateGenerationDialog,
    closeGenerationDialog,
    handleGenerationCreated,
    saveCandidate,
    discardBatch
  }
}
