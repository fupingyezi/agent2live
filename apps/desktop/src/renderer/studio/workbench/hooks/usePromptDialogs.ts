import { useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type {
  ArtProjectDto,
  CharacterDto,
  PromptBlock,
  PromptDraftDto,
  PromptSpecV2,
  PromptWorkspaceDto
} from '@studio/api'
import { queryKeys, updateCharacter } from '@studio/api'
import { useWorkbenchStore } from '../store'
import type { WorkbenchViewState } from '../view-state'
import { errorMessage } from '../workbench-helpers'

export interface UsePromptDialogsOptions {
  project: ArtProjectDto
  character: CharacterDto | null
  workspace: PromptWorkspaceDto | null
  displaySpec: PromptSpecV2 | null
  readOnly: boolean
  selectedPromptVersionId: string | null
  viewState: WorkbenchViewState
  setView: (patch: Partial<WorkbenchViewState>) => void
  queryClient: QueryClient
  persistPromptEdit: () => Promise<PromptDraftDto>
  withSaveLock: <T>(task: () => Promise<T>) => Promise<T>
  isSaveLocked: () => boolean
}

export function usePromptDialogs({
  project,
  character,
  workspace,
  displaySpec,
  readOnly,
  selectedPromptVersionId,
  viewState,
  setView,
  queryClient,
  persistPromptEdit,
  withSaveLock,
  isSaveLocked
}: UsePromptDialogsOptions) {
  const [projectInfoOpen, setProjectInfoOpen] = useState(false)
  const [versionDrawerOpen, setVersionDrawerOpen] = useState(false)
  const [referenceGalleryOpen, setReferenceGalleryOpen] = useState(false)
  const [blockDialog, setBlockDialog] = useState<{
    blockId: string | null
    negative: boolean
    block: PromptBlock | null
  } | null>(null)
  const [fullPromptOpen, setFullPromptOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [dialogSaving, setDialogSaving] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)

  const findDisplayBlock = (blockId: string): PromptBlock | null =>
    displaySpec
      ? ([...displaySpec.blocks, ...displaySpec.negativeBlocks].find((block) => block.id === blockId) ?? null)
      : null

  const openBlockDialog = (blockId: string, negative: boolean): void => {
    setDialogError(null)
    setBlockDialog({ blockId, negative, block: findDisplayBlock(blockId) })
  }

  const openNewBlockDialog = (negative: boolean): void => {
    setDialogError(null)
    setBlockDialog({ blockId: null, negative, block: null })
  }

  const openFullPrompt = (): void => {
    setDialogError(null)
    setFullPromptOpen(true)
  }

  const openRename = (): void => {
    setDialogError(null)
    setRenameOpen(true)
  }

  const closeBlockDialog = (): void => {
    if (!dialogSaving) setBlockDialog(null)
  }

  const closeFullPrompt = (): void => {
    if (!dialogSaving) setFullPromptOpen(false)
  }

  const closeRename = (): void => {
    if (!dialogSaving) setRenameOpen(false)
  }

  const commitDialogSave = async (
    apply: () => void,
    close: () => void,
    restore?: () => void
  ): Promise<void> => {
    if (readOnly) return
    if (isSaveLocked()) {
      setDialogError('正在保存，请稍候')
      return
    }
    setDialogSaving(true)
    setDialogError(null)
    let applied = false
    try {
      await withSaveLock(async () => {
        apply()
        applied = true
        const saved = await persistPromptEdit()
        useWorkbenchStore.getState().markSaved(saved.state, saved.rowVersion, saved.revision)
        await queryClient.invalidateQueries({ queryKey: queryKeys.workspace(project.id) })
        close()
      })
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

  const closeVersionDrawer = (): void => {
    setVersionDrawerOpen(false)
    if (viewState.view !== 'prompt' || !workspace) return
    const latest = [...workspace.versions].sort((left, right) => right.versionNumber - left.versionNumber)[0]
    if (latest && latest.id !== selectedPromptVersionId) {
      setView({ view: 'prompt', promptVersionId: latest.id })
    }
  }

  return {
    projectInfoOpen,
    openProjectInfo: () => setProjectInfoOpen(true),
    closeProjectInfo: () => setProjectInfoOpen(false),
    versionDrawerOpen,
    openVersionHistory: () => setVersionDrawerOpen(true),
    closeVersionDrawer,
    referenceGalleryOpen,
    openReferences: () => setReferenceGalleryOpen(true),
    closeReferences: () => setReferenceGalleryOpen(false),
    blockDialog,
    openBlockDialog,
    openNewBlockDialog,
    closeBlockDialog,
    fullPromptOpen,
    openFullPrompt,
    closeFullPrompt,
    renameOpen,
    openRename,
    closeRename,
    dialogSaving,
    dialogError,
    saveBlock,
    deleteBlock,
    saveFullPrompt,
    saveRename,
    selectPromptVersion: (versionId: string) => setView({ view: 'prompt', promptVersionId: versionId })
  }
}

export type PromptDialogsController = ReturnType<typeof usePromptDialogs>
