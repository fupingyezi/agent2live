import type { JobDto, PromptDraftDto } from '@studio/api'
import { ApiError, getJob, isTerminalJobStatus } from '@studio/api'

export interface DraftSnapshot {
  draftId: string
  revision: number
  rowVersion: number
  draft: PromptDraftDto['state']
}

export function draftSnapshot(draft: PromptDraftDto): DraftSnapshot {
  return {
    draftId: draft.id,
    revision: draft.revision,
    rowVersion: draft.rowVersion,
    draft: draft.state
  }
}

export function errorMessage(error: unknown): string | null {
  if (!error) return null
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error)
}

export const TERMINAL_GENERATION_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'unknown_outcome'])

const PROMPT_SYNC_POLL_MS = 250

const PROMPT_SYNC_TIMEOUT_MS = 135_000

export async function waitForPromptSync(jobId: string): Promise<JobDto> {
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
