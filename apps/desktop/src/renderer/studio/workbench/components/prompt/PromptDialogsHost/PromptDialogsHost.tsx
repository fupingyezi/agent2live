import React from 'react'
import type {
  ArtProjectDto,
  ArtVersionDto,
  CharacterDto,
  PromptSpecV2,
  PromptVersionDto,
  PromptWorkspaceDto
} from '@studio/api'
import { Button, Dialog, InlineNotice } from '@agent2live/design-system'
import type { AiJobRoutingController } from '../../../hooks/useAiJobRouting'
import type { PromptDialogsController } from '../../../hooks/usePromptDialogs'
import type { PromptVersioningController } from '../../../hooks/usePromptVersioning'
import { useWorkbenchStore } from '../../../store'
import { ProjectInfoDialog } from '../ProjectInfoDialog/ProjectInfoDialog'
import { VersionHistoryDrawer } from '../VersionHistoryDrawer/VersionHistoryDrawer'
import { ReferenceGalleryDialog } from '../ReferenceGalleryDialog'
import { PromptBlockDialog } from '../PromptBlockDialog'
import { FullPromptDialog } from '../FullPromptDialog'
import { RenameDialog } from '../RenameDialog'
import styles from './PromptDialogsHost.module.scss'

export interface PromptDialogsHostProps {
  project: ArtProjectDto
  character: CharacterDto | null
  characterTitle: string
  characterSummary: string | null
  workspace: PromptWorkspaceDto
  displaySpec: PromptSpecV2 | null
  readOnly: boolean
  selectedPromptVersion: PromptVersionDto | null
  artVersions: ArtVersionDto[]
  versionError: string | null
  dialogs: PromptDialogsController
  versioning: PromptVersioningController
  ai: AiJobRoutingController
}

export const PromptDialogsHost: React.FC<PromptDialogsHostProps> = ({
  project,
  character,
  characterTitle,
  characterSummary,
  workspace,
  displaySpec,
  readOnly,
  selectedPromptVersion,
  artVersions,
  versionError,
  dialogs,
  versioning,
  ai
}) => (
  <>
    <ProjectInfoDialog
      open={dialogs.projectInfoOpen}
      project={project}
      characterTitle={characterTitle}
      characterSummary={characterSummary}
      promptVersion={selectedPromptVersion ?? workspace.activePromptVersion}
      artVersions={artVersions}
      onClose={dialogs.closeProjectInfo}
    />

    <VersionHistoryDrawer
      open={dialogs.versionDrawerOpen}
      project={project}
      promptVersions={workspace.versions}
      selectedPromptVersionId={selectedPromptVersion?.id ?? null}
      onClose={dialogs.closeVersionDrawer}
      onSelectPromptVersion={dialogs.selectPromptVersion}
      onRollback={versioning.requestRollback}
    />

    <ReferenceGalleryDialog
      open={dialogs.referenceGalleryOpen}
      spec={displaySpec}
      readOnly={readOnly}
      onClose={dialogs.closeReferences}
      onChange={(references) => useWorkbenchStore.getState().updateMaterialRefs(references)}
      onOpenReverse={() => {
        dialogs.closeReferences()
        ai.openReverse()
      }}
    />

    <PromptBlockDialog
      open={dialogs.blockDialog !== null}
      spec={displaySpec}
      block={dialogs.blockDialog?.block ?? null}
      negative={dialogs.blockDialog?.negative ?? false}
      readOnly={readOnly}
      saving={dialogs.dialogSaving}
      error={dialogs.dialogError}
      onClose={dialogs.closeBlockDialog}
      onSave={dialogs.saveBlock}
      onDelete={dialogs.deleteBlock}
    />

    <FullPromptDialog
      open={dialogs.fullPromptOpen}
      value={displaySpec?.fullPrompt ?? ''}
      readOnly={readOnly}
      saving={dialogs.dialogSaving}
      error={dialogs.dialogError}
      onClose={dialogs.closeFullPrompt}
      onSave={dialogs.saveFullPrompt}
    />

    <RenameDialog
      open={dialogs.renameOpen}
      currentTitle={character?.title ?? characterTitle}
      saving={dialogs.dialogSaving}
      error={dialogs.dialogError}
      onClose={dialogs.closeRename}
      onSave={dialogs.saveRename}
    />

    <Dialog
      open={versioning.pendingRollback !== null}
      title="回到旧版提示词"
      description="会新建一个版本，旧版本保持不变。"
      onOpenChange={(open) => {
        if (!open && !versioning.rollbackBusy) versioning.setPendingRollback(null)
      }}
    >
      <p>当前有未保存的提示词修改。</p>
      {versionError ? (
        <div role="alert">
          <InlineNotice tone="danger">{versionError}</InlineNotice>
        </div>
      ) : null}
      <div className={styles['dialog-actions']!}>
        <Button
          variant="primary"
          disabled={versioning.rollbackBusy}
          onClick={() => {
            if (versioning.pendingRollback) void versioning.executeRollback(versioning.pendingRollback, true)
          }}
        >
          保存当前并回到此版
        </Button>
        <Button
          variant="secondary"
          disabled={versioning.rollbackBusy}
          onClick={() => {
            if (versioning.pendingRollback) void versioning.executeRollback(versioning.pendingRollback, false)
          }}
        >
          放弃修改并回到此版
        </Button>
        <Button
          variant="quiet"
          disabled={versioning.rollbackBusy}
          onClick={() => versioning.setPendingRollback(null)}
        >
          取消
        </Button>
      </div>
    </Dialog>
  </>
)
