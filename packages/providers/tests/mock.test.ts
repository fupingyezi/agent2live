import { describe, expect, it } from 'vitest'
import { promptReverseOutputSchema } from '@agent2live/contracts'
import { createMockChatProvider, createMockImageProvider } from '../src/mock'
import { ProviderError } from '../src/errors'

describe('mock providers', () => {
  it('returns deterministic chat text', async () => {
    const provider = createMockChatProvider()
    const first = await provider.generate(
      {
        messages: [{ role: 'user', content: 'hello' }]
      },
      { requestId: 'mock-1' }
    )
    const second = await provider.generate(
      {
        messages: [{ role: 'user', content: 'hello' }]
      },
      { requestId: 'mock-2' }
    )
    expect(first.text).toBe('mock:hello')
    expect(second.text).toBe(first.text)
  })

  it('returns requested number of decodable mock images', async () => {
    const provider = createMockImageProvider()
    const result = await provider.generate(
      {
        prompt: 'a character',
        size: '1024x1024',
        count: 2
      },
      { requestId: 'mock-3' }
    )
    expect(result.images).toHaveLength(2)
    expect(result.images[0]!.mimeType).toBe('image/png')
    expect(result.images[0]!.width).toBe(256)
    expect(result.images[1]!.sha256).not.toBe(result.images[0]!.sha256)
  })

  it('returns schema-valid reverse JSON for the mock marker', async () => {
    const provider = createMockChatProvider()
    const envelope = {
      purpose: 'prompt.reverse',
      globalNotes: '清透',
      requirements: [
        { id: 'req_identity', text: '银白长发与蓝色眼睛', strength: 'must' },
        { id: 'req_style', text: '清爽赛璐璐', strength: 'prefer' },
        { id: 'req_avoid', text: '避免写实皮肤', strength: 'avoid' }
      ],
      materials: [
        { assetId: 'ast_01J00000000000000000000000', role: 'identity_reference', note: '脸型', locked: true }
      ]
    }
    const marker = `AGENT2LIVE_MOCK_INPUT=${Buffer.from(JSON.stringify(envelope)).toString('base64url')}`
    const result = await provider.generate(
      { messages: [{ role: 'user', content: `reverse\n${marker}` }] },
      { requestId: 'r1' }
    )
    const parsed = promptReverseOutputSchema.parse(JSON.parse(result.text))
    expect(parsed.blocks[0]?.requirementRefs).toContain('req_identity')
    expect(parsed.negativeBlocks[0]?.requirementRefs).toContain('req_avoid')
  })

  it('reads the marker from any text part', async () => {
    const provider = createMockChatProvider()
    const marker = `AGENT2LIVE_MOCK_INPUT=${Buffer.from(
      JSON.stringify({ purpose: 'prompt.reverse', requirements: [], materials: [] })
    ).toString('base64url')}`
    const result = await provider.generate(
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'reverse' },
              { type: 'text', text: marker }
            ]
          }
        ]
      },
      { requestId: 'r2' }
    )
    expect(JSON.parse(result.text)).toHaveProperty('blocks')
  })

  it('supports cancellation and failure injection', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      createMockImageProvider({ delayMs: 100 }).generate(
        {
          prompt: 'x',
          size: '1024x1024'
        },
        { requestId: 'mock-4', signal: controller.signal }
      )
    ).rejects.toMatchObject({
      code: 'PROVIDER_CANCELLED'
    })
    await expect(
      createMockChatProvider({ failWith: 'PROVIDER_UNAVAILABLE' }).generate(
        {
          messages: [{ role: 'user', content: 'x' }]
        },
        { requestId: 'mock-5' }
      )
    ).rejects.toBeInstanceOf(ProviderError)
  })
})
