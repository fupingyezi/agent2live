import { useQuery } from '@tanstack/react-query'
import { getJob, isTerminalJobStatus } from '../api/queries'
import { queryKeys } from '../api/keys'

export function useJob(jobId: string | null) {
  return useQuery({
    queryKey: queryKeys.job(jobId ?? 'none'),
    queryFn: ({ signal }) => {
      if (!jobId) throw new Error('jobId is required')
      return getJob(jobId, signal)
    },
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && isTerminalJobStatus(status) ? false : 2000
    }
  })
}
