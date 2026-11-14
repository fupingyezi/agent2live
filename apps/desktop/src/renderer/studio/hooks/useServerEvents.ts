import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { invalidateForEvent } from '../api/invalidation'
import { ServerEventStream, type SseStatus } from '../api/sse'

export interface ServerEventsState {
  status: SseStatus
  retry: () => void
}

export function useServerEvents(): ServerEventsState {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<SseStatus>('connecting')
  const streamRef = useRef<ServerEventStream | null>(null)

  const start = useCallback(() => {
    streamRef.current?.stop()
    setStatus('connecting')
    const stream = new ServerEventStream({
      getServerInfo: () => window.agent2live.getServerInfo(),
      onEvent: (event) => invalidateForEvent(queryClient, event),
      onStatus: setStatus
    })
    streamRef.current = stream
    stream.start()
  }, [queryClient])

  useEffect(() => {
    start()
    return () => {
      streamRef.current?.stop()
      streamRef.current = null
    }
  }, [start])

  return { status, retry: start }
}
