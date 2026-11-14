import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAssetContent } from '../api/queries'
import { queryKeys } from '../api/keys'

export function useAssetUrl(assetId: string | null) {
  const query = useQuery({
    queryKey: queryKeys.assetContent(assetId ?? 'none'),
    queryFn: ({ signal }) => {
      if (!assetId) throw new Error('assetId is required')
      return getAssetContent(assetId, signal)
    },
    enabled: Boolean(assetId),
    staleTime: Infinity
  })
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!query.data) {
      setUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(query.data)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [query.data])

  return { url, isLoading: query.isLoading, error: query.error }
}
