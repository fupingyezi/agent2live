import { useEffect, useRef, useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type {
  ArtProjectDto,
  PromptDraftDto,
  PromptVersionDto,
  PromptWorkspaceDto,
  ProviderConnectionDto
} from '@studio/api'
import {
  commitPromptDraft,
  createPromptDraft,
  queryKeys,
  requestPromptSync,
  savePromptDraft
} from '@studio/api'
import { findDefaultTextSelection } from '@studio/providers'
import { useWorkbenchStore } from '../store'
import type { WorkbenchViewState } from '../view-state'
import { draftSnapshot, errorMessage, waitForPromptSync } from '../workbench-helpers'

export interface UsePromptDraftEditingOptions {
  project: ArtProjectDto
  workspace: PromptWorkspaceDto | null
  providers: ProviderConnectionDto[]
  providersQuery: Pick<UseQueryResult<ProviderConnectionDto[]>, 'isPending' | 'isError'>
  queryClient: QueryClient
  setView: (patch: Partial<WorkbenchViewState>) => void
  setVersionError: (message: string | null) => void
}

export function usePromptDraftEditing({
  project,
  workspace,
  providers,
  providersQuery,
  queryClient,
  setView,
  setVersionError
}: UsePromptDraftEditingOptions) {
  const hydrate = useWorkbenchStore((state) => state.hydrate)
  const applyServerDraft = useWorkbenchStore((state) => state.applyServerDraft)

  const [draftHint, setDraftHint] = useState<PromptDraftDto | null>(null)
  const [saveBusy, setSaveBusy] = useState(false)
  const hydratedDraftId = useRef<string | null>(null)
  const draftRequested = useRef(false)
  const saveLock = useRef(false)

  const activeDraft = workspace?.activeDraft ?? draftHint ?? null

  const invalidateProjectWorkspace = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspace(project.id) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) })
  }

  const invalidateVersionData = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.workspace(project.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.promptVersions(project.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.lineages }),
      queryClient.invalidateQueries({ queryKey: queryKeys.characters })
    ])
  }

  const persistPromptEdit = async (): Promise<PromptDraftDto> => {
    const live = useWorkbenchStore.getState()
    const liveDraft = live.draft
    const liveLastEdited = live.lastEdited
    const liveRowVersion = live.rowVersion
    if (!activeDraft || !liveDraft) throw new Error('当前版本没有可保存的提示词内容。')
    const expectedRowVersion = liveRowVersion ?? activeDraft.rowVersion
    let nextState = liveDraft
    if (liveLastEdited !== 'references') {
      if (providersQuery.isPending) throw new Error('模型连接仍在加载，请稍后重试保存。')
      if (providersQuery.isError) throw new Error('模型连接加载失败，请重试后再保存。')
      const selection = findDefaultTextSelection(providers)
      if (selection) {
        const sync = await requestPromptSync(
          project.id,
          activeDraft.id,
          {
            providerConnectionId: selection.connection.id,
            modelId: selection.model.id,
            source: liveLastEdited === 'blocks' ? 'blocks' : 'full',
            mode: 'sync',
            state: liveDraft
          },
          expectedRowVersion
        )
        const job = await waitForPromptSync(sync.jobId)
        const result = job.result as {
          state?: typeof liveDraft
          conflicts?: Array<{ blockId: string; message: string }>
        } | null
        if (!result?.state) throw new Error('提示词同步没有返回可保存的内容。')
        if (result.conflicts && result.conflicts.length > 0) {
          throw new Error(`锁定块冲突：${result.conflicts.map((conflict) => conflict.blockId).join('、')}`)
        }
        nextState = result.state
      }
    }
    const saved = await savePromptDraft(project.id, activeDraft.id, nextState, expectedRowVersion)
    setDraftHint(saved)
    invalidateProjectWorkspace()
    return saved
  }

  async function withSaveLock<T>(task: () => Promise<T>): Promise<T> {
    if (saveLock.current) throw new Error('正在保存，请稍候')
    saveLock.current = true
    setSaveBusy(true)
    try {
      return await task()
    } finally {
      saveLock.current = false
      setSaveBusy(false)
    }
  }

  const prepareAiRewrite = (): Promise<void> =>
    withSaveLock(async () => {
      const live = useWorkbenchStore.getState()
      if (!live.dirty) return
      if (!activeDraft || !live.draft) throw new Error('当前没有可保存的提示词草稿。')
      const saved = await savePromptDraft(
        project.id,
        activeDraft.id,
        live.draft,
        live.rowVersion ?? activeDraft.rowVersion
      )
      useWorkbenchStore.getState().markSaved(saved.state, saved.rowVersion, saved.revision)
      setDraftHint(saved)
      invalidateProjectWorkspace()
    })

  const bufferDraftFromVersion = async (version: PromptVersionDto): Promise<void> => {
    try {
      const nextBuffer = await createPromptDraft(project.id, {
        from: 'version',
        versionId: version.id
      })
      setDraftHint(nextBuffer)
      applyServerDraft(draftSnapshot(nextBuffer))
    } catch (reason) {
      setDraftHint(null)
      hydrate({
        draftId: null,
        revision: null,
        rowVersion: null,
        draft: version.state
      })
      setVersionError(errorMessage(reason))
    }
  }

  const saveCurrentVersionInternal = async (): Promise<{
    id: string
    versionNumber: number
    created: boolean
  }> => {
    const live = useWorkbenchStore.getState()
    const liveDraft = live.draft
    const liveDirty = live.dirty
    if (!activeDraft || !liveDraft || !workspace?.activePromptVersion) {
      throw new Error('当前没有可保存的提示词版本。')
    }
    const activeVersion = workspace.activePromptVersion
    if (!liveDirty && activeDraft.contentHash === activeVersion.contentHash) {
      return {
        id: activeVersion.id,
        versionNumber: activeVersion.versionNumber,
        created: false
      }
    }
    setVersionError(null)
    const saved = liveDirty ? await persistPromptEdit() : activeDraft
    if (liveDirty) {
      useWorkbenchStore.getState().markSaved(saved.state, saved.rowVersion, saved.revision)
    }
    if (saved.contentHash === activeVersion.contentHash) {
      return {
        id: activeVersion.id,
        versionNumber: activeVersion.versionNumber,
        created: false
      }
    }
    const committed = await commitPromptDraft(project.id, saved.id, saved.rowVersion, true)
    queryClient.setQueryData(queryKeys.project(project.id), committed.artProject)
    setView({ view: 'prompt', promptVersionId: committed.version.id })
    await bufferDraftFromVersion(committed.version)
    await invalidateVersionData()
    return {
      id: committed.version.id,
      versionNumber: committed.version.versionNumber,
      created: true
    }
  }

  const saveCurrentVersion = (): Promise<{
    id: string
    versionNumber: number
    created: boolean
  }> => withSaveLock(saveCurrentVersionInternal)

  const handleDraftUpdated = (updated: PromptDraftDto): void => {
    setDraftHint(updated)
    applyServerDraft(draftSnapshot(updated))
    invalidateProjectWorkspace()
  }

  useEffect(() => {
    if (!workspace) return
    if (workspace.activeDraft) {
      if (hydratedDraftId.current === workspace.activeDraft.id) return
      hydratedDraftId.current = workspace.activeDraft.id
      hydrate(draftSnapshot(workspace.activeDraft))
      return
    }
    if (!workspace.activePromptVersion) return
    const key = `version:${workspace.activePromptVersion.id}`
    if (hydratedDraftId.current === key) return
    hydratedDraftId.current = key
    hydrate({
      draftId: null,
      revision: null,
      rowVersion: null,
      draft: workspace.activePromptVersion.state
    })
  }, [hydrate, workspace?.activeDraft?.id, workspace?.activePromptVersion?.id])

  useEffect(() => {
    if (!workspace) return
    if (workspace.activeDraft) {
      draftRequested.current = true
      return
    }
    if (!workspace.activePromptVersion || draftRequested.current) return
    draftRequested.current = true
    createPromptDraft(project.id, 'active_version')
      .then((created) => {
        setDraftHint(created)
        applyServerDraft(draftSnapshot(created))
        void queryClient.invalidateQueries({ queryKey: queryKeys.workspace(project.id) })
      })
      .catch((reason) => {
        setVersionError(errorMessage(reason))
        draftRequested.current = false
      })
  }, [applyServerDraft, project.id, queryClient, workspace?.activeDraft, workspace?.activePromptVersion?.id])

  useEffect(() => {
    if (workspace?.activeDraft) setDraftHint(null)
  }, [workspace?.activeDraft?.id])

  return {
    draftHint,
    activeDraft,
    saveBusy,
    persistPromptEdit,
    prepareAiRewrite,
    handleDraftUpdated,
    withSaveLock,
    isSaveLocked: () => saveLock.current,
    saveCurrentVersion,
    saveCurrentVersionUnlocked: saveCurrentVersionInternal,
    bufferDraftFromVersion,
    invalidateVersionData
  }
}
