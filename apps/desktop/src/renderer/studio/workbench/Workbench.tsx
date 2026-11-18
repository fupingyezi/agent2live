import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ArtProjectDto, CharacterDto, PromptBlock, PromptDraftDto } from '@studio/api'
import {
  ApiError,
  commitPromptDraft,
  createPromptDraft,
  getJob,
  getPromptVersion,
  getPromptWorkspace,
  isTerminalJobStatus,
  listArtVersions,
  listProviders,
  queryKeys,
  requestPromptSync,
  savePromptDraft,
  updateCharacter
} from '@studio/api'
import { Button, Dialog, EmptyState, InlineNotice } from '@agent2live/design-system'
import { StudioError, StudioLoading } from '@studio/components'
import { findDefaultTextProvider } from '@studio/providers'
import { useWorkbenchStore } from './store'
import {
  ArtVersionPanel,
  ForkDialog,
  ForkOriginBar,
  GenerationDialog,
  PromptInputPanel,
  ReferenceChainBar,
  VersionGraph,
  type ForkSource
} from './components'
import { parseWorkbenchView, updateWorkbenchView } from './view-state'
import type { PromptFilter } from './prompt-diagnostics'
import { WorkbenchTopbar } from './components/WorkbenchTopbar'
import { WorkbenchActionBar } from './components/WorkbenchActionBar'
import { PromptWorkbenchView } from './views/PromptWorkbenchView'
import { PromptBlockDialog } from './components/prompt/PromptBlockDialog'
import { FullPromptDialog } from './components/prompt/FullPromptDialog'
import { RenameDialog } from './components/prompt/RenameDialog'
import { AiRewriteDialog } from './components/prompt/AiRewriteDialog'
import { ReverseDialog } from './components/prompt/ReverseDialog'
import { ReferenceGalleryDialog } from './components/prompt/ReferenceGalleryDialog'

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
  const resetStore = useWorkbenchStore((state) => state.reset)
  const storeDraft = useWorkbenchStore((state) => state.draft)
  const storeRowVersion = useWorkbenchStore((state) => state.rowVersion)
  const dirty = useWorkbenchStore((state) => state.dirty)

  const [draftHint, setDraftHint] = useState<PromptDraftDto | null>(null)
  const [forkSource, setForkSource] = useState<ForkSource | null>(null)
  const [generationDialogOpen, setGenerationDialogOpen] = useState(false)
  const [generationPromptVersion, setGenerationPromptVersion] = useState<{
    id: string
    versionNumber: number
  } | null>(null)
  const [workspaceDialog, setWorkspaceDialog] = useState<'materials' | 'versions' | null>(null)
  const [referenceGalleryOpen, setReferenceGalleryOpen] = useState(false)
  const [aiRewrite, setAiRewrite] = useState<{ intent: string; autoStart: boolean } | null>(null)
  const [reverseOpen, setReverseOpen] = useState(false)
  const [filter, setFilter] = useState<PromptFilter>('all')
  const [versionSubmitting, setVersionSubmitting] = useState(false)
  const [versionError, setVersionError] = useState<string | null>(null)
  const [blockDialog, setBlockDialog] = useState<{
    blockId: string | null
    negative: boolean
    block: PromptBlock | null
  } | null>(null)
  const [fullPromptOpen, setFullPromptOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [dialogSaving, setDialogSaving] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const initializedJob = useRef<string | null>(null)
  const hydratedDraftId = useRef<string | null>(null)
  const draftRequested = useRef(false)
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

  const workspace = workspaceQuery.data ?? null
  const artVersions = versionsQuery.data ?? []
  const providers = providersQuery.data ?? []
  const currentDraftRowVersion =
    useWorkbenchStore((state) => state.rowVersion) ?? workspace?.activeDraft?.rowVersion ?? null

  const selectedPromptVersionId = viewState.promptVersionId ?? workspace?.activePromptVersion?.id ?? null
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
      applyServerDraft(draftSnapshot(workspace.activeDraft))
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
  }, [applyServerDraft, hydrate, workspace?.activeDraft?.id, workspace?.activePromptVersion?.id])

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
      setAiRewrite({ intent: '', autoStart: false })
    } else {
      setReverseOpen(true)
    }
  }, [initialJob?.jobId])

  useEffect(() => {
    if (workspace?.activeDraft) setDraftHint(null)
  }, [workspace?.activeDraft?.id])

  if (workspaceQuery.isPending) {
    return (
      <section className="workbench-loading">
        <StudioLoading label="正在加载提示词工作区…" />
      </section>
    )
  }
  if (workspaceQuery.isError) {
    return (
      <section className="workbench-loading" data-testid="workspace-error">
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
      <section className="workbench-loading">
        <InlineNotice tone="warning">工作区数据为空。刷新页面或重新打开项目。</InlineNotice>
      </section>
    )
  }

  const activeDraft = workspace.activeDraft ?? draftHint
  const draft = editingActiveVersion ? activeDraft : null
  const spec = storeDraft
  const submission = workspace.latestSubmission
  const draftRowVersion = spec ? storeRowVersion : (draft?.rowVersion ?? null)
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
    if (!draft || !liveDraft) throw new Error('当前版本没有可保存的提示词内容。')
    const expectedRowVersion = liveRowVersion ?? draft.rowVersion
    let nextState = liveDraft
    if (liveLastEdited !== 'references') {
      if (providersQuery.isPending) throw new Error('模型连接仍在加载，请稍后重试保存。')
      if (providersQuery.isError) throw new Error('模型连接加载失败，请重试后再保存。')
      const provider = findDefaultTextProvider(providers)
      if (provider) {
        const sync = await requestPromptSync(
          project.id,
          draft.id,
          {
            providerConnectionId: provider.id,
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
    const saved = await savePromptDraft(project.id, draft.id, nextState, expectedRowVersion)
    setDraftHint(saved)
    invalidateProjectWorkspace()
    return saved
  }

  const prepareAiRewrite = async (): Promise<void> => {
    const live = useWorkbenchStore.getState()
    if (!live.dirty) return
    if (!draft || !live.draft) throw new Error('当前没有可保存的提示词草稿。')
    const saved = await savePromptDraft(project.id, draft.id, live.draft, live.rowVersion ?? draft.rowVersion)
    useWorkbenchStore.getState().markSaved(saved.state, saved.rowVersion, saved.revision)
    setDraftHint(saved)
    invalidateProjectWorkspace()
  }

  const saveCurrentVersion = async (): Promise<{
    id: string
    versionNumber: number
    created: boolean
  }> => {
    const live = useWorkbenchStore.getState()
    const liveDraft = live.draft
    const liveDirty = live.dirty
    if (!draft || !liveDraft || !workspace.activePromptVersion) {
      throw new Error('当前没有可保存的提示词版本。')
    }
    if (!liveDirty && draft.contentHash === workspace.activePromptVersion.contentHash) {
      return {
        id: workspace.activePromptVersion.id,
        versionNumber: workspace.activePromptVersion.versionNumber,
        created: false
      }
    }
    setVersionError(null)
    const saved = liveDirty ? await persistPromptEdit() : draft
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
    setGenerationDialogOpen(true)
    return version
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
    setDialogSaving(true)
    setDialogError(null)
    let applied = false
    try {
      apply()
      applied = true
      await saveCurrentVersion()
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

  const handleSubmitted = (result: { draft: PromptDraftDto; warnings: string[] }): void => {
    setDraftHint(result.draft)
    applyServerDraft(draftSnapshot(result.draft))
    invalidateProjectWorkspace()
  }

  const handleDraftUpdated = (updated: PromptDraftDto): void => {
    setDraftHint(updated)
    applyServerDraft(draftSnapshot(updated))
    invalidateProjectWorkspace()
  }

  const handleForkCreated = (child: ArtProjectDto): void => {
    setForkSource(null)
    setDraftHint(null)
    resetStore()
    navigate(
      `/characters/${encodeURIComponent(child.characterId)}/art?project=${encodeURIComponent(child.id)}`
    )
  }

  const title =
    viewState.view === 'candidates'
      ? '立绘工作台'
      : viewState.view === 'versions'
        ? '立绘版本'
        : '提示词工作台'

  const handleSubmitVersion = (): void => {
    setVersionSubmitting(true)
    setVersionError(null)
    saveCurrentVersion()
      .catch((reason) => setVersionError(errorMessage(reason)))
      .finally(() => setVersionSubmitting(false))
  }

  return (
    <section className="wb3-page" data-testid="workbench">
      <WorkbenchTopbar title={title} />
      <div className="wb3-body">
        {viewState.view === 'prompt' ? (
          <PromptWorkbenchView
            project={project}
            characterTitle={characterTitle}
            characterSummary={characterSummary}
            promptVersion={selectedPromptVersion}
            promptVersions={workspace.versions}
            artVersions={artVersions}
            spec={displaySpec}
            referenceCount={displaySpec?.materialRefs.length ?? 0}
            readOnly={readOnly}
            dirty={dirty}
            canCommit={canCommit}
            filter={filter}
            latestGeneration={null}
            submitting={versionSubmitting}
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
            onOpenAiRewrite={(intent) => setAiRewrite({ intent, autoStart: intent.trim().length > 0 })}
            onOpenReverse={() => setReverseOpen(true)}
            onOpenFullPrompt={() => {
              setDialogError(null)
              setFullPromptOpen(true)
            }}
            onOpenReferences={() => setReferenceGalleryOpen(true)}
            onOpenVersions={() => setWorkspaceDialog('versions')}
            onSelectPromptVersion={(versionId) => setView({ view: 'prompt', promptVersionId: versionId })}
            onRollbackToPromptVersion={() => undefined}
            onViewArtVersion={() => undefined}
            onSubmitVersion={handleSubmitVersion}
          />
        ) : (
          <div className="wb3-placeholder">
            <EmptyState
              title={viewState.view === 'candidates' ? '候选视图建设中' : '立绘版本视图建设中'}
              description="后续 Task 会接入完整交互。"
              action={
                <Button
                  variant="secondary"
                  onClick={() => setView({ view: 'prompt', promptVersionId: null })}
                >
                  返回提示词
                </Button>
              }
            />
          </div>
        )}
      </div>
      <WorkbenchActionBar
        status={
          readOnly
            ? '历史版本只读'
            : dirty
              ? '有未保存修改'
              : `当前 第 ${selectedPromptVersion?.versionNumber ?? '—'} 版 · ${
                  (displaySpec?.blocks.length ?? 0) + (displaySpec?.negativeBlocks.length ?? 0)
                } 块`
        }
      >
        <Button
          variant="primary"
          disabled={readOnly || !selectedPromptVersion || (displaySpec?.blocks.length ?? 0) === 0}
          onClick={() => {
            void openGenerationDialog().catch((reason) => setVersionError(errorMessage(reason)))
          }}
        >
          生成图片
        </Button>
      </WorkbenchActionBar>

      <GenerationDialog
        open={generationDialogOpen}
        project={project}
        promptVersions={workspace.versions}
        artVersions={artVersions}
        initialPromptVersionId={generationPromptVersion?.id ?? null}
        initialPromptVersionNumber={generationPromptVersion?.versionNumber ?? null}
        initialBaseArtVersionId={null}
        providers={providers}
        onClose={() => {
          setGenerationDialogOpen(false)
          setGenerationPromptVersion(null)
        }}
        onCreated={(created) => {
          setGenerationDialogOpen(false)
          setGenerationPromptVersion(null)
          setView({ view: 'candidates', generationId: created.generationId })
          void queryClient.invalidateQueries({ queryKey: queryKeys.generations(project.id) })
        }}
      />

      <Dialog
        open={workspaceDialog === 'materials'}
        title="素材与要求"
        description="参考图、说明和要求作为临时工作区打开，不会占用主画布。"
        onOpenChange={(open) => {
          if (!open) setWorkspaceDialog(null)
        }}
        className="workbench-workspace-dialog"
      >
        <PromptInputPanel
          projectId={project.id}
          draftRowVersion={draftRowVersion}
          submission={submission}
          disabled={dirty || (draft !== null && spec === null)}
          onSubmitted={(result) => {
            handleSubmitted(result)
            setWorkspaceDialog(null)
          }}
        />
      </Dialog>

      <Dialog
        open={workspaceDialog === 'versions'}
        title="版本操作"
        description="查看版本链、参考图继承和分支来源。"
        onOpenChange={(open) => {
          if (!open) setWorkspaceDialog(null)
        }}
        className="workbench-versions-dialog"
      >
        <div className="workbench-versions-dialog-content">
          <ReferenceChainBar project={project} activePromptVersion={workspace.activePromptVersion} />
          <ForkOriginBar project={project} />
          <VersionGraph
            project={project}
            promptVersions={workspace.versions}
            artVersions={artVersions}
            onFork={setForkSource}
          />
          <ArtVersionPanel
            project={project}
            artVersions={artVersions}
            promptVersions={workspace.versions}
            onMutated={(mutation) => {
              queryClient.setQueryData(queryKeys.project(project.id), mutation.project)
            }}
            onFork={setForkSource}
          />
        </div>
      </Dialog>

      <ReferenceGalleryDialog
        open={referenceGalleryOpen}
        spec={displaySpec}
        readOnly={readOnly}
        onClose={() => setReferenceGalleryOpen(false)}
        onChange={(references) => useWorkbenchStore.getState().updateMaterialRefs(references)}
        onOpenMaterials={() => {
          setReferenceGalleryOpen(false)
          setWorkspaceDialog('materials')
        }}
        onOpenReverse={() => {
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

      {forkSource ? (
        <ForkDialog
          open
          project={project}
          source={forkSource}
          onClose={() => setForkSource(null)}
          onCreated={handleForkCreated}
        />
      ) : null}
    </section>
  )
}
