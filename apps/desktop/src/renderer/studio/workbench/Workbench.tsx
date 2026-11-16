import React, { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ArtProjectDto, ArtVersionDto, PromptDraftDto, PromptInputMaterialDto } from '@studio/api'
import {
  ApiError,
  createPromptDraft,
  getPromptWorkspace,
  listArtVersions,
  listProviders,
  queryKeys
} from '@studio/api'
import { AsyncButton, InlineNotice, SectionHeader, StatusPill, Tabs } from '@agent2live/design-system'
import { StudioError, StudioLoading, StudioPageTopbar } from '@studio/components'
import { formatStage, stageTone } from '@studio/format'
import { useAssetUrl } from '@studio/hooks'
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
  VersionGraph,
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

interface DesignVersionCardProps {
  version: ArtVersionDto
  active: boolean
}

const DesignVersionCard: React.FC<DesignVersionCardProps> = ({ version, active }) => {
  const assetId =
    version.references.find((reference) => reference.isPrimary)?.assetId ??
    version.references[0]?.assetId ??
    null
  const { url } = useAssetUrl(assetId)
  return (
    <article className="workbench-design-version-card" data-active={active}>
      <div className="workbench-design-version-thumb">
        {url ? <img src={url} alt={`v${version.versionNumber}`} /> : null}
      </div>
      <div>
        <strong>v{version.versionNumber}</strong>
        {active ? <span>在用</span> : null}
        <small>{version.references.length} 张参考</small>
      </div>
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
  const panel = useWorkbenchStore((state) => state.panel)

  const [draftHint, setDraftHint] = useState<PromptDraftDto | null>(null)
  const [forkSource, setForkSource] = useState<ForkSource | null>(null)
  const [designView, setDesignView] = useState<'references' | 'candidates' | 'parallel'>('references')
  const [generationControlsOpen, setGenerationControlsOpen] = useState(false)
  const [candidateSaveRequest, setCandidateSaveRequest] = useState(0)
  const initializedJob = useRef<string | null>(null)
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
    if (!workspace) return
    const active = workspace.activeDraft
    hydrate({
      draftId: active?.id ?? null,
      revision: active?.revision ?? null,
      rowVersion: active?.rowVersion ?? null,
      draft: active?.state ?? null
    })
  }, [workspace, hydrate])

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

  const draft = workspace.activeDraft ?? draftHint
  const spec = draft && storeDraftId === draft.id ? storeDraft : null
  const submission = workspace.latestSubmission
  const providers = providersQuery.data ?? []
  const artVersions = versionsQuery.data ?? []
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
  const descriptionBlocks = (spec ?? draft?.state)?.blocks.slice(0, 5) ?? []
  const materialNote = (role: PromptInputMaterialDto['role']): string | null =>
    submission?.materials.find((material) => material.role === role)?.note.trim() || null
  const blockText = (...categories: string[]): string | null =>
    descriptionBlocks.find((block) => categories.includes(block.category))?.text ?? null
  const descriptionItems = [
    {
      label: '脸型',
      text: blockText('face', 'hair', 'subject') || submission?.globalNotes || `${characterTitle}的角色身份`
    },
    { label: '服饰', text: materialNote('outfit_reference') || '按角色设定与参考图核对' },
    { label: '配色', text: materialNote('color_reference') || '按参考图核对配色' },
    { label: '姿势', text: materialNote('pose_reference') || '按参考图核对姿势' },
    { label: '画风', text: materialNote('style_reference') || '按参考图核对画风' }
  ]
  const activeVersion = artVersions.find((version) => version.id === project.activeVersionId) ?? null

  const invalidateProjectWorkspace = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspace(project.id) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) })
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
        <aside className="workbench-design-version-tree">
          <h1 className="workbench-design-project-title">{project.title}</h1>
          <div className="workbench-design-identity">
            <strong>{characterTitle}</strong>
            <span>立绘工作台</span>
          </div>
          <div className="workbench-design-version-heading">
            <span>版本</span>
            <span>{artVersions.length} 版</span>
          </div>
          <div className="workbench-design-version-list">
            {artVersions.length > 0 ? (
              artVersions
                .slice(0, 4)
                .map((version) => (
                  <DesignVersionCard
                    key={version.id}
                    version={version}
                    active={version.id === project.activeVersionId}
                  />
                ))
            ) : (
              <div className="workbench-design-version-empty">
                <img src={characterEmptyArt} alt="等待出图的看板娘" />
                <span>还没有版本</span>
              </div>
            )}
          </div>
        </aside>

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

        <aside className="workbench-design-inspector">
          <header>
            <h2>角色描述</h2>
            <span>{designView === 'references' ? '逐块核对描述' : '按这五块出图'}</span>
          </header>
          <div className="workbench-design-description-list">
            {descriptionItems.length > 0 ? (
              descriptionItems.map((item, index) => (
                <article key={`${item.label}-${index}`}>
                  <span>{item.label}</span>
                  <p>{item.text}</p>
                </article>
              ))
            ) : (
              <article>
                <span>整体说明</span>
                <p>{submission?.globalNotes || '还没有角色描述。'}</p>
              </article>
            )}
          </div>
          <div className="workbench-design-inspector-footer">
            {designView === 'references' ? '改写后重新出图' : '回参考图改描述'}
          </div>
        </aside>
      </div>

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
          <aside className="workbench-version-rail" data-testid="workbench-version-rail">
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
