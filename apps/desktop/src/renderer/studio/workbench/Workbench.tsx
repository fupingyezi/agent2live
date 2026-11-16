import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ArtProjectDto,
  ArtVersionDto,
  PromptDraftDto,
  PromptInputMaterialDto,
  PromptVersionDto
} from '@studio/api'
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
  restoreArtVersion,
  savePromptDraft
} from '@studio/api'
import {
  AsyncButton,
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  InlineNotice,
  Switch
} from '@agent2live/design-system'
import { StudioError, StudioLoading, StudioPageTopbar } from '@studio/components'
import { useAssetUrl } from '@studio/hooks'
import { findDefaultTextProvider } from '@studio/providers'
import characterEmptyArt from '@studio/assets/empty-states/character-empty.png'
import { useWorkbenchStore } from './store'
import {
  ArtVersionPanel,
  ForkDialog,
  ForkOriginBar,
  GenerationDialog,
  GenerationPanel,
  PromptAiPanel,
  PromptBlockList,
  PromptInputPanel,
  ReferenceChainBar,
  UnifiedPromptInspector,
  VersionGraph,
  WorkbenchVersionRail,
  type ForkSource,
  type InitialPromptJob
} from './components'
import { uncoveredRequirementIds } from './prompt-helpers'

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
      throw new Error(`提示词同步结束于 ${job.status}${job.errorCode ? ` (${job.errorCode})` : ''}`)
    }
    await new Promise((resolve) => window.setTimeout(resolve, PROMPT_SYNC_POLL_MS))
  }
  throw new Error('提示词同步超时')
}

const MATERIAL_LABELS: Record<PromptInputMaterialDto['role'], string> = {
  identity_reference: '身份',
  style_reference: '画风',
  outfit_reference: '服装',
  color_reference: '配色',
  background_reference: '背景',
  pose_reference: '姿势',
  sketch: '草图',
  texture: '材质',
  other: '参考'
}

interface DesignReferenceCardProps {
  material: PromptInputMaterialDto
}

const DesignReferenceCard: React.FC<DesignReferenceCardProps> = ({ material }) => {
  const { url } = useAssetUrl(material.assetId)
  return (
    <article className="workbench-design-reference-card" data-testid="workbench-reference-card">
      <div className="workbench-design-reference-image">
        {url ? <img src={url} alt={MATERIAL_LABELS[material.role]} /> : <span aria-hidden="true" />}
        <span className="workbench-design-reference-role">{MATERIAL_LABELS[material.role]}</span>
      </div>
      <p>
        {material.note || (material.role === 'other' ? '补充参考' : `${MATERIAL_LABELS[material.role]}参考`)}
      </p>
    </article>
  )
}

export interface WorkbenchProps {
  project: ArtProjectDto
  characterTitle: string
  textWarning?: string | null
  aiWarning?: string | null
}

export const Workbench: React.FC<WorkbenchProps> = ({
  project,
  characterTitle,
  textWarning = null,
  aiWarning = null
}) => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const hydrate = useWorkbenchStore((state) => state.hydrate)
  const applyServerDraft = useWorkbenchStore((state) => state.applyServerDraft)
  const resetStore = useWorkbenchStore((state) => state.reset)
  const storeDraftId = useWorkbenchStore((state) => state.draftId)
  const storeDraft = useWorkbenchStore((state) => state.draft)
  const storeRowVersion = useWorkbenchStore((state) => state.rowVersion)
  const dirty = useWorkbenchStore((state) => state.dirty)
  const lastEdited = useWorkbenchStore((state) => state.lastEdited)
  const cancelLocalChanges = useWorkbenchStore((state) => state.cancelLocalChanges)

  const [draftHint, setDraftHint] = useState<PromptDraftDto | null>(null)
  const [selectedPromptVersion, setSelectedPromptVersion] = useState<PromptVersionDto | null>(null)
  const [selection, setSelection] = useState<{ kind: 'art'; versionId: string } | { kind: 'draft' } | null>(
    null
  )
  const [pendingSelection, setPendingSelection] = useState<
    { kind: 'art'; version: ArtVersionDto } | { kind: 'draft' } | null
  >(null)
  const [selectionBusy, setSelectionBusy] = useState(false)
  const [switchBusy, setSwitchBusy] = useState(false)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [forkSource, setForkSource] = useState<ForkSource | null>(null)
  const [designView, setDesignView] = useState<'references' | 'candidates' | 'parallel'>('references')
  const [generationDialogOpen, setGenerationDialogOpen] = useState(false)
  const [createdGenerationId, setCreatedGenerationId] = useState<string | null>(null)
  const [candidateSaveRequest, setCandidateSaveRequest] = useState(0)
  const [workspaceDialog, setWorkspaceDialog] = useState<'materials' | 'ai' | 'versions' | null>(null)
  const [commitDialogOpen, setCommitDialogOpen] = useState(false)
  const [commitBusy, setCommitBusy] = useState(false)
  const [acknowledgeUncovered, setAcknowledgeUncovered] = useState(false)
  const initializedJob = useRef<string | null>(null)
  const initializedSelection = useRef(false)
  const aiKind = searchParams.get('aiKind')
  const aiJob = searchParams.get('aiJob')
  const initialJob: InitialPromptJob | null =
    aiKind === 'reverse' && aiJob?.startsWith('job_') ? { kind: 'reverse', jobId: aiJob } : null

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

  const matchingDraft = useCallback(
    (promptVersionId: string | null): PromptDraftDto | null => {
      const current = draftHint ?? workspace?.activeDraft ?? null
      return current?.baseVersionId === promptVersionId ? current : null
    },
    [draftHint, workspace?.activeDraft]
  )

  const showPromptVersion = useCallback(
    async (versionId: string, createDraft: boolean, nextSelection: typeof selection): Promise<void> => {
      setSelectionBusy(true)
      setSelectionError(null)
      try {
        const promptVersion = await getPromptVersion(project.id, versionId)
        setSelectedPromptVersion(promptVersion)
        const attached = matchingDraft(promptVersion.id)
        if (attached) {
          applyServerDraft(draftSnapshot(attached))
        } else if (createDraft && !workspace?.activeDraft) {
          const created = await createPromptDraft(project.id, {
            from: 'version',
            versionId: promptVersion.id
          })
          setDraftHint(created)
          applyServerDraft(draftSnapshot(created))
          void queryClient.invalidateQueries({ queryKey: queryKeys.workspace(project.id) })
          void queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) })
        } else {
          hydrate({
            draftId: null,
            revision: null,
            rowVersion: null,
            draft: promptVersion.state
          })
          if (workspace?.activeDraft) {
            setSelectionError('当前还有基于其它提示词版本的草稿。该版本暂为只读，请先提交或处理现有草稿。')
          }
        }
        setSelection(nextSelection)
      } catch (reason) {
        setSelectionError(errorMessage(reason))
      } finally {
        setSelectionBusy(false)
      }
    },
    [applyServerDraft, draftSnapshot, hydrate, matchingDraft, project.id, queryClient, workspace?.activeDraft]
  )

  const showDraft = useCallback(async (): Promise<void> => {
    const active = draftHint ?? workspace?.activeDraft ?? null
    if (!active) return
    setSelectionBusy(true)
    setSelectionError(null)
    try {
      const versionId = active.baseVersionId ?? workspace?.activePromptVersion?.id ?? null
      if (versionId) {
        setSelectedPromptVersion(await getPromptVersion(project.id, versionId))
      } else {
        setSelectedPromptVersion(workspace?.activePromptVersion ?? null)
      }
      applyServerDraft(draftSnapshot(active))
      setSelection({ kind: 'draft' })
    } catch (reason) {
      setSelectionError(errorMessage(reason))
    } finally {
      setSelectionBusy(false)
    }
  }, [applyServerDraft, draftHint, project.id, workspace?.activeDraft, workspace?.activePromptVersion])

  useEffect(() => {
    if (initializedSelection.current || !workspace || versionsQuery.isPending) return
    initializedSelection.current = true
    const activeArt =
      artVersions.find((version) => version.id === project.activeVersionId) ?? artVersions[0] ?? null
    if (activeArt) {
      void showPromptVersion(activeArt.promptVersionId, false, {
        kind: 'art',
        versionId: activeArt.id
      })
    } else if (workspace.activeDraft) {
      void showDraft()
    } else if (workspace.activePromptVersion) {
      setSelectedPromptVersion(workspace.activePromptVersion)
      hydrate({
        draftId: null,
        revision: null,
        rowVersion: null,
        draft: workspace.activePromptVersion.state
      })
    }
  }, [
    artVersions,
    hydrate,
    project.activeVersionId,
    showDraft,
    showPromptVersion,
    versionsQuery.isPending,
    workspace
  ])

  useEffect(() => {
    if (selectedPromptVersion || !workspace?.activePromptVersion || dirty) return
    setSelectedPromptVersion(workspace.activePromptVersion)
    hydrate({
      draftId: null,
      revision: null,
      rowVersion: null,
      draft: workspace.activePromptVersion.state
    })
  }, [dirty, hydrate, selectedPromptVersion, workspace?.activePromptVersion])

  useEffect(() => {
    if (!initialJob || initializedJob.current === initialJob.jobId) return
    initializedJob.current = initialJob.jobId
    setWorkspaceDialog('ai')
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
  const draft = selectedPromptVersion === null ? activeDraft : matchingDraft(selectedPromptVersion.id)
  const spec = storeDraft
  const submission = workspace.latestSubmission
  const draftRowVersion = spec ? storeRowVersion : (draft?.rowVersion ?? null)
  const generationWorkspace = (
    <GenerationPanel
      project={project}
      workspace={workspace}
      preferredGenerationId={createdGenerationId}
      candidateSaveRequest={candidateSaveRequest}
      onAccepted={(mutation) => {
        queryClient.setQueryData(queryKeys.project(project.id), mutation.project)
        setDesignView('references')
      }}
    />
  )
  const activeVersion = artVersions.find((version) => version.id === project.activeVersionId) ?? null
  const selectedArtVersion =
    selection?.kind === 'art'
      ? (artVersions.find((version) => version.id === selection.versionId) ?? null)
      : null
  const commitSpec = spec ?? draft?.state ?? workspace.activePromptVersion?.state ?? null
  const uncoveredRequirements = commitSpec ? uncoveredRequirementIds(commitSpec) : []

  const invalidateProjectWorkspace = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspace(project.id) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) })
  }

  const saveUnifiedPrompt = async (): Promise<void> => {
    if (!draft || !storeDraft) throw new Error('当前版本没有可保存的草稿。')
    if (!dirty) return
    if (providersQuery.isPending) throw new Error('模型连接仍在加载，请稍后重试保存。')
    if (providersQuery.isError) throw new Error('模型连接加载失败，请重试后再保存。')
    const expectedRowVersion = storeRowVersion ?? draft.rowVersion
    const provider = findDefaultTextProvider(providers)
    let nextState = storeDraft
    if (provider) {
      const sync = await requestPromptSync(
        project.id,
        draft.id,
        {
          providerConnectionId: provider.id,
          source: lastEdited ?? 'full',
          mode: 'sync',
          state: storeDraft
        },
        expectedRowVersion
      )
      const job = await waitForPromptSync(sync.jobId)
      const result = job.result as {
        state?: typeof storeDraft
        conflicts?: Array<{ blockId: string; message: string }>
      } | null
      if (!result?.state) throw new Error('提示词同步没有返回可保存的内容。')
      if (result.conflicts && result.conflicts.length > 0) {
        throw new Error(`锁定块冲突：${result.conflicts.map((conflict) => conflict.blockId).join('、')}`)
      }
      nextState = result.state
    }
    const saved = await savePromptDraft(project.id, draft.id, nextState, expectedRowVersion)
    useWorkbenchStore.getState().markSaved(saved.state, saved.rowVersion, saved.revision)
    setDraftHint(saved)
    invalidateProjectWorkspace()
  }

  const startDraftForSelectedVersion = async (): Promise<void> => {
    if (!selectedPromptVersion) throw new Error('请先选择一个提示词版本。')
    if (activeDraft) {
      throw new Error('当前还有其它草稿，请先提交或处理现有草稿。')
    }
    const created = await createPromptDraft(project.id, {
      from: 'version',
      versionId: selectedPromptVersion.id
    })
    setDraftHint(created)
    applyServerDraft(draftSnapshot(created))
    setSelection(selectedArtVersion ? { kind: 'art', versionId: selectedArtVersion.id } : null)
    invalidateProjectWorkspace()
  }

  const commitCurrentVersion = async (): Promise<void> => {
    if (!draft) throw new Error('当前没有可提交的草稿。')
    setCommitBusy(true)
    setSelectionError(null)
    try {
      if (dirty) await saveUnifiedPrompt()
      const currentStore = useWorkbenchStore.getState()
      if (!currentStore.draft) throw new Error('草稿内容为空。')
      const result = await commitPromptDraft(
        project.id,
        draft.id,
        currentStore.rowVersion ?? draft.rowVersion,
        acknowledgeUncovered
      )
      queryClient.setQueryData(queryKeys.project(project.id), result.project)
      setDraftHint(null)
      setCommitDialogOpen(false)
      setAcknowledgeUncovered(false)
      setSelection(null)
      setSelectedPromptVersion(result.version)
      resetStore()
      hydrate({
        draftId: null,
        revision: null,
        rowVersion: null,
        draft: result.version.state
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workspace(project.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.promptVersions(project.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.lineages }),
        queryClient.invalidateQueries({ queryKey: queryKeys.characters })
      ])
    } catch (reason) {
      setSelectionError(errorMessage(reason))
    } finally {
      setCommitBusy(false)
    }
  }

  const performSelection = async (
    target: { kind: 'art'; version: ArtVersionDto } | { kind: 'draft' }
  ): Promise<void> => {
    if (target.kind === 'draft') {
      await showDraft()
    } else {
      await showPromptVersion(target.version.promptVersionId, true, {
        kind: 'art',
        versionId: target.version.id
      })
    }
  }

  const requestSelection = (target: { kind: 'art'; version: ArtVersionDto } | { kind: 'draft' }): void => {
    if (selectionBusy) return
    if (dirty) {
      setPendingSelection(target)
      return
    }
    void performSelection(target)
  }

  const saveAndSwitch = async (): Promise<void> => {
    if (!pendingSelection) return
    setSwitchBusy(true)
    setSelectionError(null)
    try {
      await saveUnifiedPrompt()
      const target = pendingSelection
      setPendingSelection(null)
      await performSelection(target)
    } catch (reason) {
      setSelectionError(errorMessage(reason))
    } finally {
      setSwitchBusy(false)
    }
  }

  const discardAndSwitch = async (): Promise<void> => {
    if (!pendingSelection) return
    const target = pendingSelection
    setSelectionError(null)
    cancelLocalChanges()
    setPendingSelection(null)
    await performSelection(target)
  }

  const restoreSelectedVersion = async (): Promise<void> => {
    if (!selectedArtVersion) throw new Error('请先选择一个历史美术版本。')
    if (selectedArtVersion.id === project.activeVersionId) {
      throw new Error('当前版本已经是 active，无需还原。')
    }
    const mutation = await restoreArtVersion(project.id, selectedArtVersion.id, project.rowVersion)
    queryClient.setQueryData(queryKeys.project(project.id), mutation.project)
    const current = queryClient.getQueryData<ArtVersionDto[]>(queryKeys.artVersions(project.id))
    queryClient.setQueryData<ArtVersionDto[]>(queryKeys.artVersions(project.id), [
      mutation.artVersion,
      ...(current ?? artVersions).filter((version) => version.id !== mutation.artVersion.id)
    ])
    void queryClient.invalidateQueries({ queryKey: queryKeys.artVersions(project.id) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspace(project.id) })
    await showPromptVersion(mutation.artVersion.promptVersionId, false, {
      kind: 'art',
      versionId: mutation.artVersion.id
    })
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

  return (
    <section className="workbench workbench-redesigned" data-testid="workbench">
      <div className="workbench-design">
        <WorkbenchVersionRail
          project={project}
          characterTitle={characterTitle}
          draft={activeDraft}
          artVersions={artVersions}
          promptVersions={workspace.versions}
          selectedArtVersionId={selection?.kind === 'art' ? selection.versionId : null}
          selectedDraft={selection?.kind === 'draft'}
          busy={selectionBusy}
          onSelectDraft={() => requestSelection({ kind: 'draft' })}
          onSelectVersion={(version) => requestSelection({ kind: 'art', version })}
          onOpenMaterials={() => setWorkspaceDialog('materials')}
          onOpenVersions={() => setWorkspaceDialog('versions')}
        />

        <div className="workbench-design-canvas">
          <StudioPageTopbar
            className="workbench-design-topbar"
            breadcrumb=""
            tone="editor"
            actions={
              <div className="workbench-design-viewbar">
                <div className="workbench-design-view-switch" role="group" aria-label="工作台视图">
                  <button
                    type="button"
                    aria-pressed={designView === 'references'}
                    onClick={() => {
                      setDesignView('references')
                    }}
                  >
                    参考图
                  </button>
                  <button
                    type="button"
                    aria-pressed={designView === 'candidates'}
                    onClick={() => {
                      setDesignView('candidates')
                    }}
                  >
                    候选
                  </button>
                  <button
                    type="button"
                    aria-pressed={designView === 'parallel'}
                    onClick={() => {
                      setDesignView('parallel')
                    }}
                  >
                    并排
                  </button>
                </div>
                <span className="workbench-design-view-meta">
                  {designView === 'references' ? `${submission?.materials.length ?? 0} 张参考` : '候选待选'}
                </span>
              </div>
            }
          />

          {textWarning || aiWarning ? (
            <div className="workbench-inline-warnings">
              {textWarning ? (
                <div data-testid="text-warning">
                  <InlineNotice tone="warning">
                    {textWarning === 'no-text-provider'
                      ? '没有配置 DeepSeek 文本模型，已保留设定生成的草稿；可在角色描述中继续优化。'
                      : '文本优化未完成，已保留可编辑的角色设定和提示词草稿。'}
                  </InlineNotice>
                </div>
              ) : null}
              {aiWarning ? (
                <div data-testid="ai-warning">
                  <InlineNotice tone="warning">
                    {aiWarning === 'no-vision-provider'
                      ? '没有可用的智谱多模态连接，参考图反推未启动；创建和提示词草稿已完成。'
                      : '参考图反推未能启动；创建和提示词草稿已完成，可以在 AI 助手中重试。'}
                  </InlineNotice>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="workbench-design-stage" data-view={designView} data-testid="workbench-design-stage">
            {designView === 'references' ? (
              <div className="workbench-design-reference-grid">
                {submission?.materials.length ? (
                  [...submission.materials]
                    .sort((left, right) => left.sortOrder - right.sortOrder)
                    .map((material) => <DesignReferenceCard key={material.id} material={material} />)
                ) : (
                  <div className="workbench-design-empty">
                    <img src={characterEmptyArt} alt="等待出图的看板娘" />
                    <strong>还没有参考图</strong>
                  </div>
                )}
              </div>
            ) : (
              <div className="workbench-design-generation">{generationWorkspace}</div>
            )}
          </div>

          <div className="workbench-design-task">
            <span className="workbench-design-task-dot" />
            <span>
              {designView === 'references'
                ? artVersions.length > 0
                  ? `当前在用 v${activeVersion?.versionNumber ?? '—'}`
                  : '参考已就绪，等待生成'
                : `${artVersions.length} 个美术版本，候选待选`}
            </span>
          </div>
          <footer className="workbench-design-actions">
            {designView === 'references' ? (
              <Link
                className="workbench-design-secondary-action"
                aria-label="返回档案（返回角色驾驶舱）"
                to={`/characters/${encodeURIComponent(project.characterId)}`}
              >
                返回档案
              </Link>
            ) : (
              <button
                type="button"
                className="workbench-design-secondary-action"
                onClick={() => {
                  setGenerationDialogOpen(true)
                }}
              >
                重新生成
              </button>
            )}
            <button
              type="button"
              className="workbench-design-primary-action"
              onClick={() => {
                if (designView === 'references') {
                  setDesignView('candidates')
                  setGenerationDialogOpen(true)
                } else {
                  setCandidateSaveRequest((request) => request + 1)
                }
              }}
            >
              {designView === 'references' ? '生成' : '保存为最新版本'}
            </button>
          </footer>
        </div>

        <UnifiedPromptInspector
          project={project}
          selectedArtVersion={selectedArtVersion}
          selectedPromptVersion={selectedPromptVersion}
          draft={draft}
          spec={spec}
          requirements={spec?.sourceRequirements ?? []}
          materials={submission?.materials ?? []}
          dirty={dirty}
          onSave={saveUnifiedPrompt}
          onRestore={restoreSelectedVersion}
          onOpenAi={() => setWorkspaceDialog('ai')}
          onCommit={() => {
            setAcknowledgeUncovered(false)
            setCommitDialogOpen(true)
          }}
          onStartDraft={() => {
            void startDraftForSelectedVersion()
          }}
          canStartDraft={!activeDraft && selectedPromptVersion !== null}
          startingDraft={selectionBusy}
          onGenerate={() => {
            setDesignView('candidates')
            setGenerationDialogOpen(true)
          }}
        />
        {selectionError ? (
          <div className="workbench-selection-notice" role="alert">
            <InlineNotice tone="danger">{selectionError}</InlineNotice>
          </div>
        ) : null}
      </div>

      <GenerationDialog
        open={generationDialogOpen}
        project={project}
        workspace={workspace}
        providers={providers}
        onClose={() => setGenerationDialogOpen(false)}
        onCreated={(created) => {
          setCreatedGenerationId(created.generationId)
          setGenerationDialogOpen(false)
          setDesignView('candidates')
        }}
      />

      <Dialog
        open={pendingSelection !== null}
        title="切换版本"
        description="当前提示词有未保存修改。"
        onOpenChange={(open) => {
          if (!open && !switchBusy) setPendingSelection(null)
        }}
      >
        <p>保存后会先同步完整提示词与颗粒化提示词，再切换到目标版本。</p>
        <div className="workbench-switch-dialog-actions">
          <AsyncButton
            type="button"
            busy={switchBusy}
            busyLabel="保存中…"
            disabled={switchBusy}
            onClick={() => {
              void saveAndSwitch()
            }}
          >
            保存并切换
          </AsyncButton>
          <Button
            type="button"
            variant="secondary"
            disabled={switchBusy}
            onClick={() => {
              void discardAndSwitch()
            }}
          >
            放弃并切换
          </Button>
          <Button
            type="button"
            variant="quiet"
            disabled={switchBusy}
            onClick={() => setPendingSelection(null)}
          >
            取消
          </Button>
        </div>
      </Dialog>

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
        open={workspaceDialog === 'ai'}
        title="AI 助手"
        description="反推和改进建议在临时面板中处理。"
        onOpenChange={(open) => {
          if (!open) setWorkspaceDialog(null)
        }}
        className="workbench-ai-dialog"
      >
        {providersQuery.isError ? (
          <StudioError
            error={providersQuery.error}
            onRetry={() => {
              void providersQuery.refetch()
            }}
          />
        ) : providersQuery.isPending ? (
          <StudioLoading label="正在加载模型连接…" />
        ) : (
          <PromptAiPanel
            projectId={project.id}
            workspace={workspace}
            providers={providers}
            dirty={dirty}
            initialJob={initialJob}
            onDraftUpdated={handleDraftUpdated}
          />
        )}
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
          <ReferenceChainBar
            project={project}
            artVersions={artVersions}
            activePromptVersion={workspace!.activePromptVersion}
          />
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

      <ConfirmDialog
        open={commitDialogOpen}
        title="提交为不可变提示词版本？"
        confirmLabel="提交版本"
        busy={commitBusy}
        confirmDisabled={uncoveredRequirements.length > 0 && !acknowledgeUncovered}
        onCancel={() => setCommitDialogOpen(false)}
        onConfirm={() => {
          void commitCurrentVersion()
        }}
      >
        <p>提交后会生成新的 PromptVersion 并成为当前版本；草稿将关闭，历史版本不能被修改。</p>
        {uncoveredRequirements.length > 0 ? (
          <Field
            label={`我知道有 ${uncoveredRequirements.length} 条必须/避免要求未被覆盖，仍要提交。`}
            className="confirm-ack"
          >
            <Switch
              checked={acknowledgeUncovered}
              onCheckedChange={setAcknowledgeUncovered}
              aria-label="确认提交未覆盖要求"
            />
          </Field>
        ) : null}
      </ConfirmDialog>

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
