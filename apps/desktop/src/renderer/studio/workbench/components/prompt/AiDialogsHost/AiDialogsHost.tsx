import React from 'react'
import type { PromptDraftDto, PromptSpecV2, PromptWorkspaceDto, ProviderConnectionDto } from '@studio/api'
import type { AiJobRoutingController } from '../../../hooks/useAiJobRouting'
import { AiRewriteDialog } from '../AiRewriteDialog'
import { ReverseDialog } from '../ReverseDialog'

export interface AiDialogsHostProps {
  projectId: string
  workspace: PromptWorkspaceDto
  spec: PromptSpecV2 | null
  providers: ProviderConnectionDto[]
  providersLoading: boolean
  providersError: string | null
  draftRowVersion: number | null
  dirty: boolean
  ai: AiJobRoutingController
  onPrepare: () => Promise<void>
  onDraftUpdated: (updated: PromptDraftDto) => void
}

export const AiDialogsHost: React.FC<AiDialogsHostProps> = ({
  projectId,
  workspace,
  spec,
  providers,
  providersLoading,
  providersError,
  draftRowVersion,
  dirty,
  ai,
  onPrepare,
  onDraftUpdated
}) => (
  <>
    <AiRewriteDialog
      open={ai.aiRewrite !== null}
      projectId={projectId}
      workspace={workspace}
      spec={spec}
      draftRowVersion={draftRowVersion}
      providers={providers}
      providersLoading={providersLoading}
      providersError={providersError}
      initialIntent={ai.aiRewrite?.intent ?? ''}
      autoStart={ai.aiRewrite?.autoStart ?? false}
      initialJob={ai.initialJob?.kind === 'suggest' ? ai.initialJob : null}
      onPrepare={onPrepare}
      onClose={ai.closeAiRewrite}
      onDraftUpdated={onDraftUpdated}
      onJobStarted={ai.setActiveAiJob}
      onJobResolved={() => ai.setActiveAiJob(null)}
    />

    <ReverseDialog
      open={ai.reverseOpen}
      projectId={projectId}
      workspace={workspace}
      providers={providers}
      providersLoading={providersLoading}
      providersError={providersError}
      dirty={dirty}
      draftRowVersion={draftRowVersion}
      initialJob={ai.initialJob?.kind === 'reverse' ? ai.initialJob : null}
      onClose={ai.closeReverse}
      onDraftUpdated={onDraftUpdated}
      onJobStarted={ai.setActiveAiJob}
      onJobResolved={() => ai.setActiveAiJob(null)}
    />
  </>
)
