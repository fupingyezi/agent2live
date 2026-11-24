import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { ArtProjectDto, CharacterDto } from '@studio/api'
import { AsyncButton, Button, InlineNotice } from '@agent2live/design-system'
import { StudioError, StudioLoading } from '@studio/components'
import { useWorkbenchStore } from '../store'
import { useWorkbenchData } from '../hooks/useWorkbenchData'
import { usePromptDraftEditing } from '../hooks/usePromptDraftEditing'
import { usePromptVersioning } from '../hooks/usePromptVersioning'
import { useAiJobRouting } from '../hooks/useAiJobRouting'
import { useGenerationWorkflow } from '../hooks/useGenerationWorkflow'
import { usePromptDialogs } from '../hooks/usePromptDialogs'
import { WorkbenchMoreMenu } from '../components/WorkbenchMoreMenu'
import { GenerationDialog } from '../components/generation/GenerationDialog'
import { PromptDialogsHost } from '../components/prompt/PromptDialogsHost'
import { AiDialogsHost } from '../components/prompt/AiDialogsHost'
import { parseWorkbenchView, updateWorkbenchView } from '../view-state'
import type { PromptFilter } from '../prompt-diagnostics'
import { WorkbenchTopbar } from '../components/WorkbenchTopbar'
import { WorkbenchActionBar } from '../components/WorkbenchActionBar'
import { PromptWorkbenchView } from '../views/PromptWorkbenchView'
import { CandidateWorkbenchView } from '../views/CandidateWorkbenchView'
import { WorkbenchVersionPane } from '../views/WorkbenchVersionPane'
import { errorMessage } from '../workbench-helpers'
import styles from './Workbench.module.scss'

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
  const [searchParams, setSearchParams] = useSearchParams()
  const storeDraft = useWorkbenchStore((state) => state.draft)
  const dirty = useWorkbenchStore((state) => state.dirty)

  const [filter, setFilter] = useState<PromptFilter>('all')
  const [versionError, setVersionError] = useState<string | null>(null)
  const viewState = parseWorkbenchView(searchParams)
  const setView = (patch: Parameters<typeof updateWorkbenchView>[1]): void => {
    setSearchParams((current) => updateWorkbenchView(current, patch), { replace: true })
  }

  const {
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
  } = useWorkbenchData(project, viewState)
  const currentDraftRowVersion =
    useWorkbenchStore((state) => state.rowVersion) ?? workspace?.activeDraft?.rowVersion ?? null
  const editing = usePromptDraftEditing({
    project,
    workspace,
    providers,
    providersQuery,
    queryClient,
    setView,
    setVersionError
  })
  const versioning = usePromptVersioning({
    project,
    workspace,
    queryClient,
    setView,
    draftHint: editing.draftHint,
    saveCurrentVersion: editing.saveCurrentVersion,
    saveCurrentVersionUnlocked: editing.saveCurrentVersionUnlocked,
    withSaveLock: editing.withSaveLock,
    bufferDraftFromVersion: editing.bufferDraftFromVersion,
    invalidateVersionData: editing.invalidateVersionData,
    setVersionError
  })
  const ai = useAiJobRouting({ searchParams, setSearchParams })
  const generation = useGenerationWorkflow({
    project,
    queryClient,
    setView,
    candidateGeneration,
    generationDetail,
    promptVersionNumberForGeneration,
    selectedPromptVersion,
    saveCurrentVersion: editing.saveCurrentVersion,
    setVersionError
  })

  const editingActiveVersion =
    selectedPromptVersionId !== null && selectedPromptVersionId === project.activePromptVersionId
  const displaySpec = editingActiveVersion
    ? (storeDraft ?? selectedPromptVersion?.state ?? null)
    : (selectedPromptVersion?.state ?? null)
  const readOnly = selectedPromptVersionId !== null && !editingActiveVersion
  const dialogs = usePromptDialogs({
    project,
    character,
    workspace,
    displaySpec,
    readOnly,
    selectedPromptVersionId,
    viewState,
    setView,
    queryClient,
    persistPromptEdit: editing.persistPromptEdit,
    withSaveLock: editing.withSaveLock,
    isSaveLocked: editing.isSaveLocked
  })

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

  const activeDraft = editing.activeDraft
  const saveBusy = editing.saveBusy
  const draft = editingActiveVersion ? activeDraft : null
  const spec = storeDraft
  const canCommit =
    !readOnly &&
    spec !== null &&
    (dirty ||
      (draft !== null &&
        workspace.activePromptVersion !== null &&
        draft.contentHash !== workspace.activePromptVersion.contentHash))

  const prepareAiRewrite = editing.prepareAiRewrite
  const handleDraftUpdated = editing.handleDraftUpdated
  const versionSubmitting = versioning.versionSubmitting
  const handleSubmitVersion = versioning.handleSubmitVersion

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

  return (
    <section className={styles['wb3-page']!} data-testid="workbench">
      <WorkbenchTopbar
        title={title}
        subtitle={characterTitle}
        actions={
          <WorkbenchMoreMenu
            onOpenProjectInfo={dialogs.openProjectInfo}
            onOpenVersionHistory={dialogs.openVersionHistory}
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
            onRename={dialogs.openRename}
            onOpenBlock={dialogs.openBlockDialog}
            onNewBlock={dialogs.openNewBlockDialog}
            onOpenAiRewrite={ai.openAiRewrite}
            onOpenReverse={ai.openReverse}
            onOpenFullPrompt={dialogs.openFullPrompt}
            onOpenReferences={dialogs.openReferences}
            onRegenerate={generation.regenerate}
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
            selectedCandidateId={generation.selectedCandidateId}
            savingCandidateId={generation.savingCandidateId}
            discarding={generation.discarding}
            onSelectCandidate={generation.setSelectedCandidateId}
            onSaveCandidate={generation.saveCandidate}
            onViewArtVersion={(versionId) => setView({ view: 'versions', artVersionId: versionId })}
            onSaveSelected={() => {
              if (generation.selectedCandidateId) generation.saveCandidate(generation.selectedCandidateId)
            }}
            onDiscard={generation.discardBatch}
            onRetry={() => generation.openCandidateGenerationDialog()}
            onRetrySlot={() => generation.openCandidateGenerationDialog({ count: 1 })}
            onRegenerate={() => generation.openCandidateGenerationDialog()}
            onBackToPrompt={() =>
              setView({
                view: 'prompt',
                promptVersionId: candidateGeneration?.promptVersionId ?? null
              })
            }
            error={versionError}
          />
        ) : (
          <WorkbenchVersionPane
            project={project}
            versionsQuery={versionsQuery}
            currentVersion={currentArtVersion}
            promptVersion={artPromptVersionQuery.data ?? null}
            error={versionError}
            onBackToPrompt={() => {
              setView({
                view: 'prompt',
                promptVersionId: currentArtVersion?.promptVersionId ?? null
              })
            }}
            onRegenerate={generation.regenerate}
          />
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
            onClick={generation.regenerate}
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
        open={generation.generationDialogOpen}
        project={project}
        promptVersions={workspace.versions}
        initialPromptVersionId={generation.generationPromptVersion?.id ?? selectedPromptVersion?.id ?? null}
        initialPromptVersionNumber={
          generation.generationPromptVersion?.versionNumber ?? selectedPromptVersion?.versionNumber ?? null
        }
        initialParams={generation.generationDefaults}
        currentArtworkAssetId={currentArtVersion?.artworkAssetId ?? null}
        providers={providers}
        providersLoading={providersQuery.isPending}
        providersError={
          providersQuery.isError
            ? (errorMessage(providersQuery.error) ?? '模型连接加载失败，请在设置中检查。')
            : null
        }
        onClose={generation.closeGenerationDialog}
        onCreated={generation.handleGenerationCreated}
      />

      <PromptDialogsHost
        project={project}
        character={character}
        characterTitle={characterTitle}
        characterSummary={characterSummary}
        workspace={workspace}
        displaySpec={displaySpec}
        readOnly={readOnly}
        selectedPromptVersion={selectedPromptVersion}
        artVersions={artVersions}
        versionError={versionError}
        dialogs={dialogs}
        versioning={versioning}
        ai={ai}
      />

      <AiDialogsHost
        projectId={project.id}
        workspace={workspace}
        spec={displaySpec}
        providers={providers}
        providersLoading={providersQuery.isPending}
        providersError={
          providersQuery.isError
            ? (errorMessage(providersQuery.error) ?? '模型连接加载失败，请在设置中检查。')
            : null
        }
        draftRowVersion={currentDraftRowVersion}
        dirty={dirty}
        ai={ai}
        onPrepare={prepareAiRewrite}
        onDraftUpdated={handleDraftUpdated}
      />
    </section>
  )
}
