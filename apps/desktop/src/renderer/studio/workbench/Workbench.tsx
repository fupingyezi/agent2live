import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ArtProjectDto,
  ArtVersionDto,
  PromptDraftDto,
  PromptInputMaterialDto,
  PromptVersionDto
} from '@studio/api'
import {
  ApiError,
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
  Dialog,
  InlineNotice,
  SectionHeader,
  StatusPill,
  Tabs
} from '@agent2live/design-system'
import { StudioError, StudioLoading, StudioPageTopbar } from '@studio/components'
import { formatStage, stageTone } from '@studio/format'
import { useAssetUrl } from '@studio/hooks'
import { findDefaultTextProvider } from '@studio/providers'
import characterEmptyArt from '@studio/assets/empty-states/character-empty.png'
import { useWorkbenchStore } from './store'
import {
  ArtVersionPanel,
  DraftToolbar,
  ForkDialog,
  ForkOriginBar,
  GenerationPanel,
  MaterialTray,
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

type DraftSeed = 'active_version' | 'empty'

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
  const setPanel = useWorkbenchStore((state) => state.setPanel)
  const applyServerDraft = useWorkbenchStore((state) => state.applyServerDraft)
  const resetStore = useWorkbenchStore((state) => state.reset)
  const storeDraftId = useWorkbenchStore((state) => state.draftId)
  const storeDraft = useWorkbenchStore((state) => state.draft)
  const storeRowVersion = useWorkbenchStore((state) => state.rowVersion)
  const dirty = useWorkbenchStore((state) => state.dirty)
  const lastEdited = useWorkbenchStore((state) => state.lastEdited)
  const cancelLocalChanges = useWorkbenchStore((state) => state.cancelLocalChanges)
  const panel = useWorkbenchStore((state) => state.panel)

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
  const [generationControlsOpen, setGenerationControlsOpen] = useState(false)
  const [candidateSaveRequest, setCandidateSaveRequest] = useState(0)
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

  const createDraftMutation = useMutation({
    mutationFn: (from: DraftSeed) => createPromptDraft(project.id, from),
    onSuccess: (draft) => {
      setDraftHint(draft)
      applyServerDraft(draftSnapshot(draft))
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspace(project.id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) })
    }
  })

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
    if (!initialJob || initializedJob.current === initialJob.jobId) return
    initializedJob.current = initialJob.jobId
    setPanel('ai')
  }, [initialJob?.jobId, setPanel])

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
  const createError = errorMessage(createDraftMutation.error)
  const generationWorkspace = providersQuery.isError ? (
    <StudioError
      error={providersQuery.error}
      onRetry={() => {
        void providersQuery.refetch()
      }}
    />
  ) : providersQuery.isPending ? (
    <StudioLoading label="正在加载模型连接…" />
  ) : (
    <GenerationPanel
      project={project}
      workspace={workspace}
      providers={providers}
      controlsOpen={generationControlsOpen}
      onCloseControls={() => setGenerationControlsOpen(false)}
      candidateSaveRequest={candidateSaveRequest}
      onAccepted={(mutation) => {
        queryClient.setQueryData(queryKeys.project(project.id), mutation.project)
        setPanel('versions')
        setDesignView('references')
      }}
    />
  )
  const activeVersion = artVersions.find((version) => version.id === project.activeVersionId) ?? null
  const selectedArtVersion =
    selection?.kind === 'art'
      ? (artVersions.find((version) => version.id === selection.versionId) ?? null)
      : null

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
    const current = queryClient.getQueryData<ArtVersionDto[]>(
      queryKeys.artVersions(project.id)
    )
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
                      setPanel('versions')
                    }}
                  >
                    参考图
                  </button>
                  <button
                    type="button"
                    aria-pressed={designView === 'candidates'}
                    onClick={() => {
                      setDesignView('candidates')
                      setPanel('generate')
                    }}
                  >
                    候选
                  </button>
                  <button
                    type="button"
                    aria-pressed={designView === 'parallel'}
                    onClick={() => {
                      setDesignView('parallel')
                      setPanel('generate')
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

          <div className="workbench-design-stage" data-view={designView} data-testid="workbench-design-stage">
            {panel !== 'generate' ? (
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
                  setPanel('generate')
                  setGenerationControlsOpen(true)
                }}
              >
                重新生成
              </button>
            )}
            <button
              type="button"
              className="workbench-design-primary-action"
              onClick={() => {
                setPanel('generate')
                if (designView === 'references') {
                  setDesignView('candidates')
                  setGenerationControlsOpen(true)
                } else {
                  setGenerationControlsOpen(false)
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
          onGenerate={() => {
            setPanel('generate')
            setDesignView('candidates')
            setGenerationControlsOpen(true)
          }}
        />
        {selectionError || createError ? (
          <div className="workbench-selection-notice" role="alert">
            <InlineNotice tone="danger">{selectionError ?? createError}</InlineNotice>
          </div>
        ) : null}
      </div>

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

      <div className="workbench-functional-dock">
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
                : '参考图反推未能启动；创建和提示词草稿已完成，可以稍后在 AI 助手中重试。'}
            </InlineNotice>
          </div>
        ) : null}
        <div className="workbench-context">
          <ReferenceChainBar
            project={project}
            artVersions={artVersions}
            activePromptVersion={workspace.activePromptVersion}
          />
          <ForkOriginBar project={project} />
        </div>

        <div className="workbench-grid">
          <aside className="workbench-version-rail" data-testid="workbench-legacy-version-rail">
            <div className="workbench-version-heading">
              <span className="eyebrow">当前项目</span>
              <strong>{project.title}</strong>
              <span className="studio-meta">{formatStage(project.stage)}</span>
            </div>
            <div className="workbench-version-summary">
              <span>提示词</span>
              <strong>
                {workspace.activePromptVersion ? `v${workspace.activePromptVersion.versionNumber}` : '待提交'}
              </strong>
              <span className="studio-meta">{workspace.versions.length} 个历史版本</span>
            </div>
            <div className="workbench-version-summary">
              <span>美术版本</span>
              <strong>
                {project.activeVersionId
                  ? `v${artVersions.find((item) => item.id === project.activeVersionId)?.versionNumber ?? '—'}`
                  : '待生成'}
              </strong>
              <span className="studio-meta">{artVersions.length} 个历史版本</span>
            </div>
            <StatusPill
              label={project.activeVersionId ? '当前参考已就绪' : '尚未激活美术版本'}
              tone={stageTone(project.stage)}
            />
          </aside>

          <div className="workbench-main">
            {panel === 'generate' ? null : (
              <>
                {submission ? <MaterialTray submission={submission} /> : null}

                <PromptInputPanel
                  projectId={project.id}
                  draftRowVersion={draftRowVersion}
                  submission={submission}
                  disabled={dirty || (draft !== null && spec === null)}
                  onSubmitted={handleSubmitted}
                />

                {dirty ? (
                  <div data-testid="unsaved-notice">
                    <InlineNotice tone="warning">
                      提示词有未保存修改。保存或撤销后，才能更新素材与要求、调用 AI 或提交版本。
                    </InlineNotice>
                  </div>
                ) : null}

                {draft ? (
                  spec ? (
                    <PromptBlockList
                      spec={spec}
                      requirements={spec.sourceRequirements}
                      materials={submission?.materials ?? []}
                      disabled={false}
                    />
                  ) : (
                    <StudioLoading label="正在载入草稿…" />
                  )
                ) : null}

                {!draft ? (
                  <section className="workbench-panel no-draft-panel" data-testid="no-active-draft">
                    <SectionHeader
                      title="没有活动草稿"
                      description={
                        workspace.activePromptVersion
                          ? `以提示词 v${workspace.activePromptVersion.versionNumber} 为起点创建可编辑草稿；在提交新版本前，现有版本不会被改变。`
                          : '提交素材与要求会自动创建草稿；也可以先创建一个空白草稿。'
                      }
                    />
                    <p className="muted">也可以展开上方“素材与要求”，直接提交素材和文本要求来创建草稿。</p>
                    <AsyncButton
                      type="button"
                      busy={createDraftMutation.isPending}
                      busyLabel="创建中…"
                      data-testid="create-draft"
                      onClick={() =>
                        createDraftMutation.mutate(workspace.activePromptVersion ? 'active_version' : 'empty')
                      }
                    >
                      {workspace.activePromptVersion
                        ? `从提示词 v${workspace.activePromptVersion.versionNumber} 继续编辑`
                        : '创建空白草稿'}
                    </AsyncButton>
                    {createError ? (
                      <div role="alert">
                        <InlineNotice tone="danger">{createError}</InlineNotice>
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {draft && spec ? (
                  <DraftToolbar
                    project={project}
                    draft={draft}
                    spec={spec}
                    dirty={dirty}
                    busy={false}
                    onOpenAi={() => setPanel('ai')}
                    onOpenGeneration={() => setPanel('generate')}
                    onCommitted={() => {
                      setDraftHint(null)
                      setPanel('versions')
                    }}
                  />
                ) : null}
              </>
            )}
          </div>

          <aside className="workbench-side">
            <Tabs
              label="工作台面板"
              value={panel}
              onValueChange={(value) => {
                if (value === 'versions' || value === 'ai' || value === 'generate') setPanel(value)
              }}
              items={[
                {
                  id: 'versions',
                  label: '版本',
                  content: versionsQuery.isPending ? (
                    <StudioLoading label="正在加载美术版本…" />
                  ) : versionsQuery.isError ? (
                    <StudioError
                      error={versionsQuery.error}
                      onRetry={() => {
                        void versionsQuery.refetch()
                      }}
                    />
                  ) : (
                    <>
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
                          setPanel('versions')
                        }}
                        onFork={setForkSource}
                      />
                    </>
                  )
                },
                {
                  id: 'ai',
                  label: 'AI 助手',
                  content: providersQuery.isError ? (
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
                  )
                },
                {
                  id: 'generate',
                  label: '生成',
                  content: (
                    <InlineNotice tone="info">
                      生成设置和候选比较已展开到主画布；选择“版本”可返回提示词编辑。
                    </InlineNotice>
                  )
                }
              ]}
            />
          </aside>
        </div>

        {forkSource ? (
          <ForkDialog
            open
            project={project}
            source={forkSource}
            onClose={() => setForkSource(null)}
            onCreated={handleForkCreated}
          />
        ) : null}
      </div>
    </section>
  )
}
