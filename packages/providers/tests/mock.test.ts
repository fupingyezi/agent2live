import { describe, expect, it } from 'vitest'
import { promptReverseOutputSchema, promptSuggestionOutputSchema } from '@agent2live/contracts'
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

  it('keeps unseeded mock images stable and conditions output on the seed', async () => {
    const provider = createMockImageProvider()
    const base = { prompt: 'a character', size: '512x896', count: 1 }
    const first = await provider.generate(base, { requestId: 'mock-seed-1' })
    const repeat = await provider.generate(base, { requestId: 'mock-seed-2' })
    const seeded = await provider.generate({ ...base, seed: 2 }, { requestId: 'mock-seed-3' })
    expect(repeat.images[0]!.sha256).toBe(first.images[0]!.sha256)
    expect(seeded.images[0]!.sha256).not.toBe(first.images[0]!.sha256)
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

  it('returns schema-valid suggestion operations for the mock marker', async () => {
    const provider = createMockChatProvider()
    const envelope = {
      purpose: 'prompt.suggestion',
      intent: '增加柔和逆光',
      blocks: [{ id: 'subject.identity', weight: 1.2, locked: true }]
    }
    const marker = `AGENT2LIVE_MOCK_INPUT=${Buffer.from(JSON.stringify(envelope)).toString('base64url')}`
    const result = await provider.generate(
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'suggest' },
              { type: 'text', text: marker }
            ]
          }
        ]
      },
      { requestId: 'r2' }
    )
    const parsed = promptSuggestionOutputSchema.parse(JSON.parse(result.text))
    expect(parsed.operations[0]).toMatchObject({ op: 'add', block: { source: 'ai-suggestion' } })
  })

  it('appends a valid weight increase for the first unlocked suggestion block', async () => {
    const provider = createMockChatProvider()
    const envelope = {
      purpose: 'prompt.suggestion',
      intent: '提高权重',
      blocks: [
        { id: 'style.rendering', weight: 1, locked: false },
        { id: 'subject.identity', weight: 1, locked: true }
      ]
    }
    const marker = `AGENT2LIVE_MOCK_INPUT=${Buffer.from(JSON.stringify(envelope)).toString('base64url')}`
    const result = await provider.generate(
      { messages: [{ role: 'user', content: `suggest\n${marker}` }] },
      { requestId: 'suggest-weight' }
    )
    const parsed = promptSuggestionOutputSchema.parse(JSON.parse(result.text))
    expect(parsed.operations).toHaveLength(2)
    expect(parsed.operations[0]).toMatchObject({ op: 'add' })
    expect(parsed.operations[1]).toMatchObject({
      op: 'setWeight',
      blockId: 'style.rendering',
      before: 1,
      after: 1.2
    })
  })

  it('skips unlocked blocks already at maximum weight when choosing the weight increase', async () => {
    const provider = createMockChatProvider()
    const envelope = {
      purpose: 'prompt.suggestion',
      intent: '提高权重',
      blocks: [
        { id: 'style.rendering', weight: 2, locked: false },
        { id: 'background.simple', weight: 1.5, locked: false }
      ]
    }
    const marker = `AGENT2LIVE_MOCK_INPUT=${Buffer.from(JSON.stringify(envelope)).toString('base64url')}`
    const result = await provider.generate(
      { messages: [{ role: 'user', content: `suggest\n${marker}` }] },
      { requestId: 'suggest-weight-max' }
    )
    const parsed = promptSuggestionOutputSchema.parse(JSON.parse(result.text))
    expect(parsed.operations).toHaveLength(2)
    expect(parsed.operations[1]).toMatchObject({
      op: 'setWeight',
      blockId: 'background.simple',
      before: 1.5,
      after: 1.7
    })
  })

  it('returns only the add operation when every unlocked block is at maximum weight', async () => {
    const provider = createMockChatProvider()
    const envelope = {
      purpose: 'prompt.suggestion',
      intent: '提高权重',
      blocks: [{ id: 'style.rendering', weight: 2, locked: false }]
    }
    const marker = `AGENT2LIVE_MOCK_INPUT=${Buffer.from(JSON.stringify(envelope)).toString('base64url')}`
    const result = await provider.generate(
      { messages: [{ role: 'user', content: `suggest\n${marker}` }] },
      { requestId: 'suggest-weight-noop' }
    )
    const parsed = promptSuggestionOutputSchema.parse(JSON.parse(result.text))
    expect(parsed.operations).toHaveLength(1)
    expect(parsed.operations[0]).toMatchObject({ op: 'add' })
  })

  it('falls back when a suggestion marker envelope is malformed', async () => {
    const provider = createMockChatProvider()
    const envelopes = [
      { purpose: 'prompt.suggestion' },
      { purpose: 'prompt.suggestion', intent: 42, blocks: [{ id: 'a', weight: 1, locked: false }] },
      { purpose: 'prompt.suggestion', intent: '增加逆光', blocks: 'nope' },
      { purpose: 'prompt.suggestion', intent: '增加逆光', blocks: [null] },
      { purpose: 'prompt.suggestion', intent: '增加逆光', blocks: [{ id: 'a' }] }
    ]
    for (const envelope of envelopes) {
      const marker = `AGENT2LIVE_MOCK_INPUT=${Buffer.from(JSON.stringify(envelope)).toString('base64url')}`
      const result = await provider.generate(
        {
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'suggest' },
                { type: 'text', text: marker }
              ]
            }
          ]
        },
        { requestId: 'r3' }
      )
      expect(result.text.startsWith('mock:')).toBe(true)
    }
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
