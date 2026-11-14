import { describe, expect, it, vi } from 'vitest'
import type { QueryClient } from '@tanstack/react-query'
import { invalidateForEvent } from './invalidation'
import { queryKeys } from './keys'
import type { ServerEvent } from './sse'

function event(scopeKind: string, scopeId: string | null): ServerEvent {
  return {
    schemaVersion: 'event/1',
    seq: 1,
    type: 'character.updated',
    scope: { kind: scopeKind, id: scopeId },
    payload: {},
    requestId: 'req_1',
    traceId: 'trc_1',
    createdAt: 1_760_000_000_000
  }
}

function mockClient(): { client: QueryClient; keys: () => unknown[] } {
  const calls: unknown[] = []
  const invalidateQueries = vi.fn(async (filters: { queryKey: readonly unknown[] }) => {
    calls.push(filters.queryKey)
  })
  return {
    client: { invalidateQueries } as unknown as QueryClient,
    keys: () => calls
  }
}

describe('invalidateForEvent', () => {
  it('invalidates character detail, list, lineage, and backups on character events', () => {
    const { client, keys } = mockClient()
    invalidateForEvent(client, event('character', 'chr_1'))
    expect(keys()).toEqual([
      queryKeys.characters,
      queryKeys.character('chr_1'),
      queryKeys.lineages,
      queryKeys.lineage('chr_1'),
      queryKeys.backups('chr_1')
    ])
  })

  it('invalidates all project-prefixed queries and lineage on project events', () => {
    const { client, keys } = mockClient()
    invalidateForEvent(client, event('project', 'ap_1'))
    expect(keys()).toEqual([queryKeys.projects, queryKeys.lineages, queryKeys.characters])
  })

  it('invalidates a single job and system providers only for their scopes', () => {
    const job = mockClient()
    invalidateForEvent(job.client, event('job', 'job_1'))
    expect(job.keys()).toEqual([queryKeys.job('job_1')])

    const system = mockClient()
    invalidateForEvent(system.client, event('system', null))
    expect(system.keys()).toEqual([queryKeys.providers])
  })

  it('ignores unknown scopes and null ids where an id is required', () => {
    const { client, keys } = mockClient()
    invalidateForEvent(client, event('unknown', 'x'))
    invalidateForEvent(client, event('project', null))
    expect(keys()).toEqual([])
  })
})
