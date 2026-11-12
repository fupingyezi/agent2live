import { expect, it } from 'vitest'
import { getLogContext, runWithLogContext } from './context'

it('propagates context across awaits and isolates concurrent runs', async () => {
  const seen: Array<string | undefined> = []
  await Promise.all([
    runWithLogContext({ requestId: 'req_a', traceId: 'trc_a' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      seen.push(getLogContext()?.requestId)
    }),
    runWithLogContext({ requestId: 'req_b', traceId: 'trc_b' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      seen.push(getLogContext()?.requestId)
    })
  ])
  expect(seen.sort()).toEqual(['req_a', 'req_b'])
  expect(getLogContext()).toBeUndefined()
})
