import type { QueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys'
import type { ServerEvent } from './sse'

export function invalidateForEvent(client: QueryClient, event: ServerEvent): void {
  const { kind, id } = event.scope

  if (kind === 'character') {
    void client.invalidateQueries({ queryKey: queryKeys.characters })
    if (id) {
      void client.invalidateQueries({ queryKey: queryKeys.character(id) })
    }
    void client.invalidateQueries({ queryKey: queryKeys.lineages })
    if (id) {
      void client.invalidateQueries({ queryKey: queryKeys.lineage(id) })
      void client.invalidateQueries({ queryKey: queryKeys.backups(id) })
    }
    return
  }

  if (kind === 'project') {
    if (!id) return
    void client.invalidateQueries({ queryKey: queryKeys.projects })
    void client.invalidateQueries({ queryKey: queryKeys.lineages })
    void client.invalidateQueries({ queryKey: queryKeys.characters })
    return
  }

  if (kind === 'job') {
    if (id) void client.invalidateQueries({ queryKey: queryKeys.job(id) })
    return
  }

  if (kind === 'system') {
    void client.invalidateQueries({ queryKey: queryKeys.providers })
  }
}
