import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ArtProjectDto, PromptDraftDto } from '@studio/api'
import {
  ApiError,
  createPromptDraft,
  getPromptWorkspace,
  listArtVersions,
  listProviders,
  queryKeys
} from '@studio/api'
import { AsyncButton, InlineNotice, SectionHeader, StatusPill, Tabs } from '@agent2live/design-system'
import { StudioError, StudioLoading } from '@studio/components'
import { formatStage, stageTone } from '@studio/format'
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
  type ForkSource
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

export interface WorkbenchProps {
  project: ArtProjectDto
  aiWarning?: string | null
}

export const Workbench: React.FC<WorkbenchProps> = ({ project, aiWarning = null }) => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
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
      onAccepted={(mutation) => {
        queryClient.setQueryData(queryKeys.project(project.id), mutation.project)
        setPanel('versions')
      }}
    />
  )

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
    <section className="workbench" data-testid="workbench">
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
          {panel === 'generate' ? (
            generationWorkspace
          ) : (
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
    </section>
  )
}
