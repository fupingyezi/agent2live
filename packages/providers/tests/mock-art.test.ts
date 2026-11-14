import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { createMockArtProvider } from '../src/mock-art'

describe('mock art provider', () => {
  it('returns deterministic chat JSON for reverse and suggestions', async () => {
    const provider = createMockArtProvider()
    const first = await provider.chat.generate(
      {
        messages: [{ role: 'user', content: 'reverse this' }],
        model: 'mock-art'
      },
      { requestId: 'req_1' }
    )
    const second = await provider.chat.generate(
      {
        messages: [{ role: 'user', content: 'reverse this' }],
        model: 'mock-art'
      },
      { requestId: 'req_2' }
    )
    expect(first.text).toBe(second.text)
    expect(JSON.parse(first.text)).toMatchObject({ operations: expect.any(Array) })
  })

  it('produces a deterministically colored 512x896 image', async () => {
    const provider = createMockArtProvider()
    const result = await provider.image.generate(
      {
        prompt: 'same prompt',
        size: '512x896',
        count: 2,
        referenceImages: []
      },
      { requestId: 'req_img' }
    )
    expect(result.images).toHaveLength(2)
    for (const image of result.images) {
      expect(image.width).toBe(512)
      expect(image.height).toBe(896)
      expect(image.mimeType).toBe('image/png')
      const metadata = await sharp(image.data).metadata()
      expect(metadata.width).toBe(512)
      expect(metadata.height).toBe(896)
      const same = await provider.image.generate(
        {
          prompt: 'same prompt',
          size: '512x896',
          count: 1,
          referenceImages: []
        },
        { requestId: 'req_img_2' }
      )
      expect(same.images[0]!.sha256).toBe(image.sha256)
    }
  })

  it('honors abort and rejects unsupported size', async () => {
    const provider = createMockArtProvider({ delayMs: 50 })
    const controller = new AbortController()
    controller.abort()
    await expect(
      provider.image.generate(
        {
          prompt: 'x',
          size: '512x896',
          count: 1
        },
        { requestId: 'r', signal: controller.signal }
      )
    ).rejects.toMatchObject({ code: 'PROVIDER_CANCELLED' })
    await expect(
      provider.image.generate(
        {
          prompt: 'x',
          size: '1x1',
          count: 1
        },
        { requestId: 'r' }
      )
    ).rejects.toMatchObject({ code: 'PROVIDER_INVALID_REQUEST' })
  })
})
