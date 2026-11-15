import { describe, expect, it } from 'vitest'

import { IPC_CHANNELS } from '@desktop/shared'
import { mountModel } from '@renderer/shared'
import { queryKeys } from '@studio/api'
import { StudioError } from '@studio/components'
import { useJob } from '@studio/hooks'
import { createProviderFlow } from '@studio/providers'
import { CharactersPage } from '@studio/routes'
import { Workbench } from '@studio/workbench'
import { GenerationPanel } from '@studio/workbench/components'

describe('Studio public module entry points', () => {
  it('resolves stable APIs through the shared path aliases', () => {
    expect(IPC_CHANNELS.getServerInfo).toBe('server:get-info')
    expect(mountModel).toBeTypeOf('function')
    expect(queryKeys).toBeTypeOf('object')
    expect(StudioError).toBeTypeOf('function')
    expect(useJob).toBeTypeOf('function')
    expect(createProviderFlow).toBeTypeOf('function')
    expect(CharactersPage).toBeTypeOf('function')
    expect(Workbench).toBeTypeOf('function')
    expect(GenerationPanel).toBeTypeOf('function')
  })
})
