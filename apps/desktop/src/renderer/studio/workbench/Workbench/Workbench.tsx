import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ArtProjectDto, CharacterDto, PromptBlock, PromptDraftDto, PromptVersionDto } from '@studio/api'
import {
  acceptGenerationCandidate,
  ApiError,
  commitPromptDraft,
  createPromptDraft,
  discardGeneration,
  getGeneration,
  getJob,
  getPromptVersion,
  getPromptWorkspace,
  isTerminalJobStatus,
  listArtVersions,
  listGenerations,
  listProviders,
  queryKeys,
  requestPromptSync,
  savePromptDraft,
  updateCharacter
} from '@studio/api'
import { AsyncButton, Button, Dialog, InlineNotice } from '@agent2live/design-system'
import { StudioError, StudioLoading } from '@studio/components'
import { findDefaultTextSelection, providerDisplayName } from '@studio/providers'
import { useWorkbenchStore } from '../store'
import { WorkbenchMoreMenu } from '../components/WorkbenchMoreMenu'
import { GenerationDialog, type GenerationDefaults } from '../components/GenerationDialog'
import { parseWorkbenchView, updateWorkbenchView } from '../view-state'
import type { PromptFilter } from '../prompt-diagnostics'
import { WorkbenchTopbar } from '../components/WorkbenchTopbar'
import { WorkbenchActionBar } from '../components/WorkbenchActionBar'
import { PromptWorkbenchView } from '../views/PromptWorkbenchView'
import { CandidateWorkbenchView } from '../views/CandidateWorkbenchView'
import { ArtVersionView } from '../views/ArtVersionView'
import { PromptBlockDialog } from '../components/prompt/PromptBlockDialog'
import { FullPromptDialog } from '../components/prompt/FullPromptDialog'
import { RenameDialog } from '../components/prompt/RenameDialog'
import { AiRewriteDialog } from '../components/prompt/AiRewriteDialog'
import { ReverseDialog } from '../components/prompt/ReverseDialog'
import { ReferenceGalleryDialog } from '../components/prompt/ReferenceGalleryDialog'
import { ProjectInfoDialog } from '../components/prompt/ProjectInfoDialog/ProjectInfoDialog'
import { VersionHistoryDrawer } from '../components/prompt/VersionHistoryDrawer/VersionHistoryDrawer'
import styles from './Workbench.module.scss'

function draftSnapshot(draft: PromptDraftDto): {
  draftId: string
  revision: number
  rowVersion: number
  draft: PromptDraftDto['state']
} {
  return {
    draftId: draft.id,
    revision: draft.revision,
    rowVersion: draft.rowVersion,
    draft: draft.state
  }
}

function errorMessage(error: unknown): string | null {
  if (!error) return null
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error)
}

const PROMPT_SYNC_POLL_MS = 250

const PROMPT_SYNC_TIMEOUT_MS = 135_000

const TERMINAL_GENERATION_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'unknown_outcome'])

async function waitForPromptSync(jobId: string) {
  const deadline = Date.now() + PROMPT_SYNC_TIMEOUT_MS
  while (Date.now() < deadline) {
    const job = await getJob(jobId)
    if (job.status === 'succeeded') return job
    if (isTerminalJobStatus(job.status)) {
      throw new Error(
        `提示词同步结束于 ${job.status}${job.errorMessage ? `：${job.errorMessage}` : ''}${
          job.errorCode ? ` (${job.errorCode})` : ''
        }`
      )
    }
    await new Promise((resolve) => window.setTimeout(resolve, PROMPT_SYNC_POLL_MS))
  }
  throw new Error('提示词同步超时')
}

type AiJobKind = 'reverse' | 'suggest'

type InitialPromptJob = { kind: 'suggest'; jobId: string } | { kind: 'reverse'; jobId: string }

interface ActiveAiJob {
  kind: AiJobKind
  jobId: string
}

export interface WorkbenchProps {
  project: ArtProjectDto
  character?: CharacterDto | null
  characterTitle: string
  characterSummary?: string | null
  textWarning?: string | null
  aiWarning?: string | null
}

export const Workbench: React.FC<WorkbenchProps> = ({
  project,
  character = null,
  characterTitle,
  characterSummary = null,
  textWarning = null,
  aiWarning = null
}) => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const hydrate = useWorkbenchStore((state) => state.hydrate)
  const applyServerDraft = useWorkbenchStore((state) => state.applyServerDraft)
  const storeDraft = useWorkbenchStore((state) => state.draft)
  const dirty = useWorkbenchStore((state) => state.dirty)

  const [draftHint, setDraftHint] = useState<PromptDraftDto | null>(null)
  const [generationDialogOpen, setGenerationDialogOpen] = useState(false)
  const [generationDefaults, setGenerationDefaults] = useState<GenerationDefaults | null>(null)
  const [generationPromptVersion, setGenerationPromptVersion] = useState<{
    id: string
    versionNumber: number
  } | null>(null)
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [savingCandidateId, setSavingCandidateId] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const [projectInfoOpen, setProjectInfoOpen] = useState(false)
  const [versionDrawerOpen, setVersionDrawerOpen] = useState(false)
  const [referenceGalleryOpen, setReferenceGalleryOpen] = useState(false)
  const [aiRewrite, setAiRewrite] = useState<{ intent: string; autoStart: boolean } | null>(null)
  const [reverseOpen, setReverseOpen] = useState(false)
  const [filter, setFilter] = useState<PromptFilter>('all')
  const [versionSubmitting, setVersionSubmitting] = useState(false)
  const [versionError, setVersionError] = useState<string | null>(null)
  const [pendingRollback, setPendingRollback] = useState<PromptVersionDto | null>(null)
  const [rollbackBusy, setRollbackBusy] = useState(false)
  const [blockDialog, setBlockDialog] = useState<{
    blockId: string | null
    negative: boolean
    block: PromptBlock | null
  } | null>(null)
  const [fullPromptOpen, setFullPromptOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [dialogSaving, setDialogSaving] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [saveBusy, setSaveBusy] = useState(false)
  const initializedJob = useRef<string | null>(null)
  const hydratedDraftId = useRef<string | null>(null)
  const draftRequested = useRef(false)
  const rollbackRequesting = useRef(false)
  const saveLock = useRef(false)
  const viewState = parseWorkbenchView(searchParams)
  const setView = (patch: Parameters<typeof updateWorkbenchView>[1]): void => {
    setSearchParams((current) => updateWorkbenchView(current, patch), { replace: true })
  }
  const aiKind = searchParams.get('aiKind')
  const aiJob = searchParams.get('aiJob')
  const initialJob: InitialPromptJob | null =
    (aiKind === 'reverse' || aiKind === 'suggest') && aiJob?.startsWith('job_')
      ? { kind: aiKind, jobId: aiJob }
      : null
  const setActiveAiJob = useCallback(
    (job: ActiveAiJob | null): void => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (job) {
            next.set('aiKind', job.kind)
            next.set('aiJob', job.jobId)
          } else {
            next.delete('aiKind')
            next.delete('aiJob')
          }
          return next
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

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
  const currentDraftRowVersion =
    useWorkbenchStore((state) => state.rowVersion) ?? workspace?.activeDraft?.rowVersion ?? null

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

  const candidateProvider = providers.find(
    (provider) => provider.id === candidateGeneration?.providerConnectionId
  )
  const providerLabel = candidateGeneration
    ? `${candidateProvider ? providerDisplayName(candidateProvider) : '未指定'} · ${candidateGeneration.modelId ?? '默认模型'}`
    : '未指定'
  const defaultTextSelection = findDefaultTextSelection(providers)
  const defaultTextLabel = defaultTextSelection
    ? `${providerDisplayName(defaultTextSelection.provider)} · ${defaultTextSelection.model.name ?? defaultTextSelection.model.id}`
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
  const editingActiveVersion =
    selectedPromptVersionId !== null && selectedPromptVersionId === project.activePromptVersionId
  const displaySpec = editingActiveVersion
    ? (storeDraft ?? selectedPromptVersion?.state ?? null)
    : (selectedPromptVersion?.state ?? null)
  const readOnly = selectedPromptVersionId !== null && !editingActiveVersion

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
    if (!initialJob || initializedJob.current === initialJob.jobId) return
    initializedJob.current = initialJob.jobId
    if (initialJob.kind === 'suggest') {
      setAiRewrite((current) => current ?? { intent: '', autoStart: false })
    } else {
      setReverseOpen(true)
    }
  }, [initialJob?.jobId])

  useEffect(() => {
    if (workspace?.activeDraft) setDraftHint(null)
  }, [workspace?.activeDraft?.id])

  useEffect(() => {
    if (viewState.view !== 'prompt' || !viewState.promptVersionId) return
    if (!workspace || workspaceQuery.isFetching) return
    if (workspace.versions.some((version) => version.id === viewState.promptVersionId)) return
    if (workspace.activePromptVersion?.id === viewState.promptVersionId) return
    const resolvedId = workspace.activePromptVersion?.id ?? null
    if (resolvedId === viewState.promptVersionId) return
    setView({ view: 'prompt', promptVersionId: resolvedId })
  }, [setView, viewState.promptVersionId, viewState.view, workspace, workspaceQuery.isFetching])

  useEffect(() => {
    if (viewState.view !== 'candidates' || !viewState.generationId) return
    if (generationDetailQuery.isFetching) return
    if (generationDetail) return
    if (!generationDetailQuery.data && !generationDetailQuery.isError) return
    if (generationsQuery.isPending || generationsQuery.isFetching) return
    const items = generationsQuery.data ?? []
    if (items.some((generation) => generation.id === viewState.generationId)) return
    const fallbackId = items[0]?.id ?? null
    if (fallbackId === viewState.generationId) return
    setView({ generationId: fallbackId })
  }, [
    generationDetail,
    generationDetailQuery.data,
    generationDetailQuery.isError,
    generationDetailQuery.isFetching,
    generationsQuery.data,
    generationsQuery.isFetching,
    generationsQuery.isPending,
    setView,
    viewState.generationId,
    viewState.view
  ])

  if (workspaceQuery.isPending) {
    return (
      <section className={styles['workbench-loading']!}>
        <StudioLoading label="正在加载提示词工作区…" />
      </section>
    )
  }
  if (workspaceQuery.isError) {
    return (
      <section className={styles['workbench-loading']!} data-testid="workspace-error">
        <StudioError
          error={workspaceQuery.error}
          onRetry={() => {
            void workspaceQuery.refetch()
          }}
        />
      </section>
    )
  }
  if (!workspace) {
    return (
      <section className={styles['workbench-loading']!}>
        <InlineNotice tone="warning">工作区数据为空。刷新页面或重新打开项目。</InlineNotice>
      </section>
    )
  }

  const activeDraft = workspace.activeDraft ?? draftHint
  const draft = editingActiveVersion ? activeDraft : null
  const spec = storeDraft
  const canCommit =
    !readOnly &&
    spec !== null &&
    (dirty ||
      (draft !== null &&
        workspace.activePromptVersion !== null &&
        draft.contentHash !== workspace.activePromptVersion.contentHash))

  const invalidateProjectWorkspace = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspace(project.id) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) })
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
            providerConnectionId: selection.provider.id,
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

  const prepareAiRewrite = async (): Promise<void> => {
    if (saveLock.current) throw new Error('正在保存，请稍候')
    saveLock.current = true
    setSaveBusy(true)
    try {
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
    } finally {
      saveLock.current = false
      setSaveBusy(false)
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
    if (!activeDraft || !liveDraft || !workspace.activePromptVersion) {
      throw new Error('当前没有可保存的提示词版本。')
    }
    if (!liveDirty && activeDraft.contentHash === workspace.activePromptVersion.contentHash) {
      return {
        id: workspace.activePromptVersion.id,
        versionNumber: workspace.activePromptVersion.versionNumber,
        created: false
      }
    }
    setVersionError(null)
    const saved = liveDirty ? await persistPromptEdit() : activeDraft
    if (liveDirty) {
      useWorkbenchStore.getState().markSaved(saved.state, saved.rowVersion, saved.revision)
    }
    if (saved.contentHash === workspace.activePromptVersion.contentHash) {
      return {
        id: workspace.activePromptVersion.id,
        versionNumber: workspace.activePromptVersion.versionNumber,
        created: false
      }
    }
    const committed = await commitPromptDraft(project.id, saved.id, saved.rowVersion, true)
    queryClient.setQueryData(queryKeys.project(project.id), committed.project)
    setView({ view: 'prompt', promptVersionId: committed.version.id })
    try {
      const nextBuffer = await createPromptDraft(project.id, {
        from: 'version',
        versionId: committed.version.id
      })
      setDraftHint(nextBuffer)
      applyServerDraft(draftSnapshot(nextBuffer))
    } catch (reason) {
      setDraftHint(null)
      hydrate({
        draftId: null,
        revision: null,
        rowVersion: null,
        draft: committed.version.state
      })
      setVersionError(errorMessage(reason))
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.workspace(project.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.promptVersions(project.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.lineages }),
      queryClient.invalidateQueries({ queryKey: queryKeys.characters })
    ])
    return {
      id: committed.version.id,
      versionNumber: committed.version.versionNumber,
      created: true
    }
  }

  const saveCurrentVersion = async (): Promise<{
    id: string
    versionNumber: number
    created: boolean
  }> => {
    if (saveLock.current) throw new Error('正在保存，请稍候')
    saveLock.current = true
    setSaveBusy(true)
    try {
      return await saveCurrentVersionInternal()
    } finally {
      saveLock.current = false
      setSaveBusy(false)
    }
  }

  async function executeRollback(target: PromptVersionDto, saveFirst: boolean): Promise<void> {
    if (saveLock.current) {
      setVersionError('正在保存，请稍候')
      return
    }
    saveLock.current = true
    setSaveBusy(true)
    setRollbackBusy(true)
    setVersionError(null)
    try {
      if (saveFirst) {
        await saveCurrentVersionInternal()
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
      queryClient.setQueryData(queryKeys.project(project.id), committed.project)
      try {
        const nextBuffer = await createPromptDraft(project.id, {
          from: 'version',
          versionId: committed.version.id
        })
        setDraftHint(nextBuffer)
        applyServerDraft(draftSnapshot(nextBuffer))
      } catch (reason) {
        setDraftHint(null)
        hydrate({
          draftId: null,
          revision: null,
          rowVersion: null,
          draft: committed.version.state
        })
        setVersionError(errorMessage(reason))
      }
      setView({ view: 'prompt', promptVersionId: committed.version.id })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workspace(project.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.promptVersions(project.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.lineages }),
        queryClient.invalidateQueries({ queryKey: queryKeys.characters })
      ])
      setPendingRollback(null)
    } catch (reason) {
      setVersionError(errorMessage(reason))
    } finally {
      saveLock.current = false
      setSaveBusy(false)
      setRollbackBusy(false)
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
        const activeVersion = workspace.activePromptVersion
        const editableDraft = draftHint ?? workspace.activeDraft
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

  const saveCandidate = (candidateId: string): void => {
    setSavingCandidateId(candidateId)
    setVersionError(null)
    acceptGenerationCandidate(candidateId, project.activeVersionId)
      .then((mutation) => {
        queryClient.setQueryData(queryKeys.project(project.id), mutation.project)
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

  const findDisplayBlock = (blockId: string): PromptBlock | null =>
    displaySpec
      ? ([...displaySpec.blocks, ...displaySpec.negativeBlocks].find((block) => block.id === blockId) ?? null)
      : null

  const commitDialogSave = async (
    apply: () => void,
    close: () => void,
    restore?: () => void
  ): Promise<void> => {
    if (readOnly) return
    if (saveLock.current) {
      setDialogError('正在保存，请稍候')
      return
    }
    saveLock.current = true
    setDialogSaving(true)
    setDialogError(null)
    let applied = false
    try {
      apply()
      applied = true
      const saved = await persistPromptEdit()
      useWorkbenchStore.getState().markSaved(saved.state, saved.rowVersion, saved.revision)
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspace(project.id) })
      close()
    } catch (reason) {
      if (applied && restore) {
        try {
          restore()
        } catch {
          // Restoring the pre-apply block is best effort; the save error below stays visible.
        }
      }
      setDialogError(errorMessage(reason))
    } finally {
      saveLock.current = false
      setDialogSaving(false)
    }
  }

  const saveBlock = (block: PromptBlock): void => {
    const original = blockDialog?.block ?? null
    void commitDialogSave(
      () => useWorkbenchStore.getState().replaceBlock(block),
      () => setBlockDialog(null),
      original ? () => useWorkbenchStore.getState().replaceBlock(original) : undefined
    )
  }

  const deleteBlock = (blockId: string): void => {
    const original = blockDialog?.block ?? null
    void commitDialogSave(
      () => useWorkbenchStore.getState().removeBlock(blockId),
      () => setBlockDialog(null),
      original ? () => useWorkbenchStore.getState().replaceBlock(original) : undefined
    )
  }

  const saveFullPrompt = (value: string): void => {
    void commitDialogSave(
      () => useWorkbenchStore.getState().updateFullPrompt(value),
      () => setFullPromptOpen(false)
    )
  }

  const saveRename = (title: string): void => {
    if (!character) {
      setDialogError('角色信息未加载。')
      return
    }
    setDialogSaving(true)
    setDialogError(null)
    updateCharacter(project.characterId, { title }, character.rowVersion)
      .then(() => {
        setRenameOpen(false)
        return Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.character(project.characterId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.characters }),
          queryClient.invalidateQueries({ queryKey: queryKeys.lineages }),
          queryClient.invalidateQueries({ queryKey: queryKeys.lineage(project.characterId) })
        ])
      })
      .catch((reason) => setDialogError(errorMessage(reason)))
      .finally(() => setDialogSaving(false))
  }

  const handleDraftUpdated = (updated: PromptDraftDto): void => {
    setDraftHint(updated)
    applyServerDraft(draftSnapshot(updated))
    invalidateProjectWorkspace()
  }

  const title =
    viewState.view === 'candidates'
      ? '立绘工作台'
      : viewState.view === 'versions'
        ? '当前立绘'
        : '提示词工作台'
  const saveStatus = readOnly
    ? '历史版本只读'
    : dirty
      ? '有未保存修改'
      : canCommit
        ? '草稿待提交为新版本'
        : `当前 第 ${selectedPromptVersion?.versionNumber ?? '—'} 版`

  const handleSubmitVersion = (): void => {
    setVersionSubmitting(true)
    setVersionError(null)
    saveCurrentVersion()
      .catch((reason) => setVersionError(errorMessage(reason)))
      .finally(() => setVersionSubmitting(false))
  }

  const closeVersionDrawer = (): void => {
    setVersionDrawerOpen(false)
    if (viewState.view !== 'prompt') return
    const latest = [...workspace.versions].sort((left, right) => right.versionNumber - left.versionNumber)[0]
    if (latest && latest.id !== selectedPromptVersionId) {
      setView({ view: 'prompt', promptVersionId: latest.id })
    }
  }

  return (
    <section className={styles['wb3-page']!} data-testid="workbench">
      <WorkbenchTopbar
        title={title}
        subtitle={characterTitle}
        actions={
          <WorkbenchMoreMenu
            onOpenProjectInfo={() => setProjectInfoOpen(true)}
            onOpenVersionHistory={() => setVersionDrawerOpen(true)}
          />
        }
      />
      <div className={styles['wb3-body']!}>
        {viewState.view === 'prompt' ? (
          <PromptWorkbenchView
            project={project}
            characterTitle={characterTitle}
            characterSummary={characterSummary}
            promptVersion={selectedPromptVersion}
            artVersions={artVersions}
            spec={displaySpec}
            referenceCount={displaySpec?.materialRefs.length ?? 0}
            readOnly={readOnly}
            busy={saveBusy}
            filter={filter}
            latestGeneration={readOnly ? null : latestGeneration}
            promptVersionError={promptVersionError}
            error={versionError}
            onFilterChange={setFilter}
            onRename={() => {
              setDialogError(null)
              setRenameOpen(true)
            }}
            onOpenBlock={(blockId, negative) => {
              setDialogError(null)
              setBlockDialog({ blockId, negative, block: findDisplayBlock(blockId) })
            }}
            onNewBlock={(negative) => {
              setDialogError(null)
              setBlockDialog({ blockId: null, negative, block: null })
            }}
            onOpenAiRewrite={() => {
              setActiveAiJob(null)
              setAiRewrite({ intent: '', autoStart: false })
            }}
            onOpenReverse={() => {
              setActiveAiJob(null)
              setReverseOpen(true)
            }}
            onOpenFullPrompt={() => {
              setDialogError(null)
              setFullPromptOpen(true)
            }}
            onOpenReferences={() => setReferenceGalleryOpen(true)}
            onRegenerate={() => {
              void openGenerationDialog().catch((reason) => setVersionError(errorMessage(reason)))
            }}
            onViewArtVersion={(versionId) => setView({ view: 'versions', artVersionId: versionId })}
          />
        ) : viewState.view === 'candidates' ? (
          <CandidateWorkbenchView
            generation={candidateGeneration}
            loading={candidateGenerationLoading}
            promptVersionNumber={promptVersionNumberForGeneration}
            baseVersionId={candidateGeneration?.baseArtVersionId ?? null}
            baseVersion={candidateBaseVersion}
            providerLabel={providerLabel}
            selectedCandidateId={selectedCandidateId}
            savingCandidateId={savingCandidateId}
            discarding={discarding}
            onSelectCandidate={setSelectedCandidateId}
            onSaveCandidate={saveCandidate}
            onViewArtVersion={(versionId) => setView({ view: 'versions', artVersionId: versionId })}
            onSaveSelected={() => {
              if (selectedCandidateId) saveCandidate(selectedCandidateId)
            }}
            onDiscard={discardBatch}
            onRetry={() => openCandidateGenerationDialog()}
            onRetrySlot={() => openCandidateGenerationDialog({ count: 1 })}
            onRegenerate={() => openCandidateGenerationDialog()}
            onBackToPrompt={() =>
              setView({
                view: 'prompt',
                promptVersionId: candidateGeneration?.promptVersionId ?? null
              })
            }
            error={versionError}
          />
        ) : versionsQuery.isPending ? (
          <section className={styles['workbench-loading']!}>
            <StudioLoading label="正在加载当前立绘…" />
          </section>
        ) : versionsQuery.isError && !versionsQuery.data ? (
          <section className={styles['workbench-loading']!} data-testid="versions-error">
            <StudioError
              error={versionsQuery.error}
              onRetry={() => {
                void versionsQuery.refetch()
              }}
            />
          </section>
        ) : (
          <div className={styles['wb3-version-shell']!}>
            {versionsQuery.isError ? (
              <div className={styles['wb3-version-refetch-error']!} data-testid="wb3-version-refetch-error">
                <InlineNotice tone="danger">
                  刷新当前立绘失败：{errorMessage(versionsQuery.error) ?? '请重试。'}
                </InlineNotice>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void versionsQuery.refetch()
                  }}
                >
                  重试
                </Button>
              </div>
            ) : null}
            <ArtVersionView
              project={project}
              currentVersion={currentArtVersion}
              promptVersion={artPromptVersionQuery.data ?? null}
              error={versionError}
              onBackToPrompt={() => {
                setView({
                  view: 'prompt',
                  promptVersionId: currentArtVersion?.promptVersionId ?? null
                })
              }}
              onRegenerate={() => {
                void openGenerationDialog().catch((reason) => setVersionError(errorMessage(reason)))
              }}
              onOpenLayered={() => {
                if (currentArtVersion) {
                  navigate(
                    `/characters/${encodeURIComponent(project.characterId)}/live2d?artVersion=${encodeURIComponent(currentArtVersion.id)}`
                  )
                }
              }}
            />
          </div>
        )}
      </div>
      {viewState.view === 'prompt' ? (
        <WorkbenchActionBar
          status={
            <>
              {saveStatus}
              <span className="studio-meta">同步模型：{defaultTextLabel}</span>
            </>
          }
        >
          <Button
            variant="primary"
            disabled={
              readOnly || saveBusy || !selectedPromptVersion || (displaySpec?.blocks.length ?? 0) === 0
            }
            onClick={() => {
              void openGenerationDialog().catch((reason) => setVersionError(errorMessage(reason)))
            }}
          >
            生成图片
          </Button>
          <AsyncButton
            variant="secondary"
            busy={versionSubmitting}
            busyLabel="提交中…"
            disabled={readOnly || !canCommit || versionSubmitting || saveBusy}
            onClick={handleSubmitVersion}
          >
            提交为新版本
          </AsyncButton>
        </WorkbenchActionBar>
      ) : null}

      <GenerationDialog
        open={generationDialogOpen}
        project={project}
        promptVersions={workspace.versions}
        initialPromptVersionId={generationPromptVersion?.id ?? selectedPromptVersion?.id ?? null}
        initialPromptVersionNumber={
          generationPromptVersion?.versionNumber ?? selectedPromptVersion?.versionNumber ?? null
        }
        initialParams={generationDefaults}
        currentArtworkAssetId={currentArtVersion?.artworkAssetId ?? null}
        providers={providers}
        providersLoading={providersQuery.isPending}
        providersError={
          providersQuery.isError
            ? (errorMessage(providersQuery.error) ?? '模型连接加载失败，请在设置中检查。')
            : null
        }
        onClose={() => {
          setGenerationDialogOpen(false)
          setGenerationPromptVersion(null)
          setGenerationDefaults(null)
        }}
        onCreated={(created) => {
          setGenerationDialogOpen(false)
          setGenerationPromptVersion(null)
          setGenerationDefaults(null)
          setView({ view: 'candidates', generationId: created.generationId })
        }}
      />

      <ProjectInfoDialog
        open={projectInfoOpen}
        project={project}
        characterTitle={characterTitle}
        characterSummary={characterSummary}
        promptVersion={selectedPromptVersion ?? workspace.activePromptVersion}
        artVersions={artVersions}
        onClose={() => setProjectInfoOpen(false)}
      />

      <VersionHistoryDrawer
        open={versionDrawerOpen}
        project={project}
        promptVersions={workspace.versions}
        selectedPromptVersionId={selectedPromptVersion?.id ?? null}
        onClose={closeVersionDrawer}
        onSelectPromptVersion={(versionId) => setView({ view: 'prompt', promptVersionId: versionId })}
        onRollback={requestRollback}
      />

      <ReferenceGalleryDialog
        open={referenceGalleryOpen}
        spec={displaySpec}
        readOnly={readOnly}
        onClose={() => setReferenceGalleryOpen(false)}
        onChange={(references) => useWorkbenchStore.getState().updateMaterialRefs(references)}
        onOpenReverse={() => {
          setActiveAiJob(null)
          setReferenceGalleryOpen(false)
          setReverseOpen(true)
        }}
      />

      <AiRewriteDialog
        open={aiRewrite !== null}
        projectId={project.id}
        workspace={workspace}
        spec={displaySpec}
        draftRowVersion={currentDraftRowVersion}
        providers={providers}
        providersLoading={providersQuery.isPending}
        providersError={
          providersQuery.isError
            ? (errorMessage(providersQuery.error) ?? '模型连接加载失败，请在设置中检查。')
            : null
        }
        initialIntent={aiRewrite?.intent ?? ''}
        autoStart={aiRewrite?.autoStart ?? false}
        initialJob={initialJob?.kind === 'suggest' ? initialJob : null}
        onPrepare={prepareAiRewrite}
        onClose={() => setAiRewrite(null)}
        onDraftUpdated={handleDraftUpdated}
        onJobStarted={(job) => setActiveAiJob(job)}
        onJobResolved={() => setActiveAiJob(null)}
      />

      <ReverseDialog
        open={reverseOpen}
        projectId={project.id}
        workspace={workspace}
        providers={providers}
        providersLoading={providersQuery.isPending}
        providersError={
          providersQuery.isError
            ? (errorMessage(providersQuery.error) ?? '模型连接加载失败，请在设置中检查。')
            : null
        }
        dirty={dirty}
        draftRowVersion={currentDraftRowVersion}
        initialJob={initialJob?.kind === 'reverse' ? initialJob : null}
        onClose={() => setReverseOpen(false)}
        onDraftUpdated={handleDraftUpdated}
        onJobStarted={(job) => setActiveAiJob(job)}
        onJobResolved={() => setActiveAiJob(null)}
      />

      <PromptBlockDialog
        open={blockDialog !== null}
        spec={displaySpec}
        block={blockDialog?.block ?? null}
        negative={blockDialog?.negative ?? false}
        readOnly={readOnly}
        saving={dialogSaving}
        error={dialogError}
        onClose={() => {
          if (!dialogSaving) setBlockDialog(null)
        }}
        onSave={saveBlock}
        onDelete={deleteBlock}
      />

      <FullPromptDialog
        open={fullPromptOpen}
        value={displaySpec?.fullPrompt ?? ''}
        readOnly={readOnly}
        saving={dialogSaving}
        error={dialogError}
        onClose={() => {
          if (!dialogSaving) setFullPromptOpen(false)
        }}
        onSave={saveFullPrompt}
      />

      <RenameDialog
        open={renameOpen}
        currentTitle={character?.title ?? characterTitle}
        saving={dialogSaving}
        error={dialogError}
        onClose={() => {
          if (!dialogSaving) setRenameOpen(false)
        }}
        onSave={saveRename}
      />

      <Dialog
        open={pendingRollback !== null}
        title="回到旧版提示词"
        description="会新建一个版本，旧版本保持不变。"
        onOpenChange={(open) => {
          if (!open && !rollbackBusy) setPendingRollback(null)
        }}
      >
        <p>当前有未保存的提示词修改。</p>
        {versionError ? (
          <div role="alert">
            <InlineNotice tone="danger">{versionError}</InlineNotice>
          </div>
        ) : null}
        <div className={styles['wb3-dialog-actions']!}>
          <Button
            variant="primary"
            disabled={rollbackBusy}
            onClick={() => {
              if (pendingRollback) void executeRollback(pendingRollback, true)
            }}
          >
            保存当前并回到此版
          </Button>
          <Button
            variant="secondary"
            disabled={rollbackBusy}
            onClick={() => {
              if (pendingRollback) void executeRollback(pendingRollback, false)
            }}
          >
            放弃修改并回到此版
          </Button>
          <Button variant="quiet" disabled={rollbackBusy} onClick={() => setPendingRollback(null)}>
            取消
          </Button>
        </div>
      </Dialog>
    </section>
  )
}
