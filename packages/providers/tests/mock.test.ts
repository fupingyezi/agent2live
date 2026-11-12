import { describe, expect, it } from 'vitest'
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
