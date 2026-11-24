import { useRef, useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type { ArtProjectDto, PromptDraftDto, PromptVersionDto, PromptWorkspaceDto } from '@studio/api'
import {
  commitPromptDraft,
  createPromptDraft,
  getPromptVersion,
  queryKeys,
  savePromptDraft
} from '@studio/api'
import { useWorkbenchStore } from '../store'
import type { WorkbenchViewState } from '../view-state'
import { errorMessage } from '../workbench-helpers'

export interface UsePromptVersioningOptions {
  project: ArtProjectDto
  workspace: PromptWorkspaceDto | null
  queryClient: QueryClient
  setView: (patch: Partial<WorkbenchViewState>) => void
  draftHint: PromptDraftDto | null
  saveCurrentVersion: () => Promise<{ id: string; versionNumber: number; created: boolean }>
  saveCurrentVersionUnlocked: () => Promise<{ id: string; versionNumber: number; created: boolean }>
  withSaveLock: <T>(task: () => Promise<T>) => Promise<T>
  bufferDraftFromVersion: (version: PromptVersionDto) => Promise<void>
  invalidateVersionData: () => Promise<void>
  setVersionError: (message: string | null) => void
}

export function usePromptVersioning({
  project,
  workspace,
  queryClient,
  setView,
  draftHint,
  saveCurrentVersion,
  saveCurrentVersionUnlocked,
  withSaveLock,
  bufferDraftFromVersion,
  invalidateVersionData,
  setVersionError
}: UsePromptVersioningOptions) {
  const [versionSubmitting, setVersionSubmitting] = useState(false)
  const [pendingRollback, setPendingRollback] = useState<PromptVersionDto | null>(null)
  const [rollbackBusy, setRollbackBusy] = useState(false)
  const rollbackRequesting = useRef(false)

  const executeRollback = async (target: PromptVersionDto, saveFirst: boolean): Promise<void> => {
    try {
      await withSaveLock(async () => {
        setRollbackBusy(true)
        setVersionError(null)
        try {
          if (saveFirst) {
            await saveCurrentVersionUnlocked()
          } else {
            useWorkbenchStore.getState().cancelLocalChanges()
          }
          const live = useWorkbenchStore.getState()
          let draftId = live.draftId
          let rowVersion = live.rowVersion
          if (!draftId || rowVersion === null) {
            const created = await createPromptDraft(project.id, {
              from: 'version',
              versionId: target.id
            })
            draftId = created.id
            rowVersion = created.rowVersion
          } else {
            const saved = await savePromptDraft(project.id, draftId, target.state, rowVersion)
            rowVersion = saved.rowVersion
          }
          const committed = await commitPromptDraft(project.id, draftId, rowVersion, true)
          queryClient.setQueryData(queryKeys.project(project.id), committed.artProject)
          await bufferDraftFromVersion(committed.version)
          setView({ view: 'prompt', promptVersionId: committed.version.id })
          await invalidateVersionData()
          setPendingRollback(null)
        } catch (reason) {
          setVersionError(errorMessage(reason))
        } finally {
          setRollbackBusy(false)
        }
      })
    } catch (reason) {
      setVersionError(errorMessage(reason))
    }
  }

  const requestRollback = (versionId: string): void => {
    if (rollbackRequesting.current) return
    if (versionId === project.activePromptVersionId) {
      setView({ view: 'prompt', promptVersionId: versionId })
      return
    }
    rollbackRequesting.current = true
    setVersionError(null)
    getPromptVersion(project.id, versionId)
      .then(async (version) => {
        const live = useWorkbenchStore.getState()
        const activeVersion = workspace?.activePromptVersion ?? null
        const editableDraft = draftHint ?? workspace?.activeDraft ?? null
        const activeVersionIsCurrent =
          activeVersion !== null && activeVersion.id === project.activePromptVersionId
        const draftAhead =
          activeVersionIsCurrent &&
          editableDraft !== null &&
          editableDraft.contentHash !== activeVersion.contentHash
        if (live.dirty || draftAhead) {
          setPendingRollback(version)
        } else {
          await executeRollback(version, false)
        }
      })
      .catch((reason) => setVersionError(errorMessage(reason)))
      .finally(() => {
        rollbackRequesting.current = false
      })
  }

  const handleSubmitVersion = (): void => {
    setVersionSubmitting(true)
    setVersionError(null)
    saveCurrentVersion()
      .catch((reason) => setVersionError(errorMessage(reason)))
      .finally(() => setVersionSubmitting(false))
  }

  return {
    versionSubmitting,
    pendingRollback,
    setPendingRollback,
    rollbackBusy,
    handleSubmitVersion,
    executeRollback,
    requestRollback
  }
}

export type PromptVersioningController = ReturnType<typeof usePromptVersioning>
