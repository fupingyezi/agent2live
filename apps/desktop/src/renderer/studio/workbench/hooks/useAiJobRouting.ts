import { useCallback, useEffect, useRef, useState } from 'react'
import type { SetURLSearchParams } from 'react-router-dom'

export type AiJobKind = 'reverse' | 'suggest'

export type InitialPromptJob = { kind: 'suggest'; jobId: string } | { kind: 'reverse'; jobId: string }

export interface ActiveAiJob {
  kind: AiJobKind
  jobId: string
}

export interface UseAiJobRoutingOptions {
  searchParams: URLSearchParams
  setSearchParams: SetURLSearchParams
}

export function useAiJobRouting({ searchParams, setSearchParams }: UseAiJobRoutingOptions) {
  const [aiRewrite, setAiRewrite] = useState<{ intent: string; autoStart: boolean } | null>(null)
  const [reverseOpen, setReverseOpen] = useState(false)
  const initializedJob = useRef<string | null>(null)

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

  useEffect(() => {
    if (!initialJob || initializedJob.current === initialJob.jobId) return
    initializedJob.current = initialJob.jobId
    if (initialJob.kind === 'suggest') {
      setAiRewrite((current) => current ?? { intent: '', autoStart: false })
    } else {
      setReverseOpen(true)
    }
  }, [initialJob?.jobId])

  const openAiRewrite = (): void => {
    setActiveAiJob(null)
    setAiRewrite({ intent: '', autoStart: false })
  }

  const openReverse = (): void => {
    setActiveAiJob(null)
    setReverseOpen(true)
  }

  return {
    initialJob,
    aiRewrite,
    reverseOpen,
    setActiveAiJob,
    openAiRewrite,
    closeAiRewrite: () => setAiRewrite(null),
    openReverse,
    closeReverse: () => setReverseOpen(false)
  }
}

export type AiJobRoutingController = ReturnType<typeof useAiJobRouting>
