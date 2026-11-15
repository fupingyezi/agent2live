import { afterEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { SeedreamImageProvider } from '../src/seedream'
import { sendJson, startTestServer, type TestServer } from './helpers'

let server: TestServer | null = null

afterEach(async () => {
  await server?.close()
  server = null
})

function provider(baseUrl: string): SeedreamImageProvider {
  return new SeedreamImageProvider({
    baseUrl,
    apiKey: 'seedream-secret',
    model: 'test-seedream-model'
  })
}

async function png(): Promise<Buffer> {
  return sharp({
    create: { width: 8, height: 8, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } }
  })
    .png()
    .toBuffer()
}

describe('SeedreamImageProvider', () => {
  it('sends reference images and sequential options; downloads and hashes outputs', async () => {
    const image = await png()
    server = await startTestServer(async (request, response) => {
      if (request.method === 'POST' && request.url === '/v1/images/generations') {
        sendJson(response, 200, {
          data: [
            { url: `${server!.url}/image-1.png`, size: '8x8' },
            { url: `${server!.url}/image-2.png`, size: '8x8' }
          ]
        })
        return
      }
      if (request.url === '/image-1.png' || request.url === '/image-2.png') {
        response.writeHead(200, { 'content-type': 'image/png' })
        response.end(image)
        return
      }
      response.writeHead(404).end()
    })

    const result = await provider(`${server.url}/v1`).generate(
      {
        prompt: 'a flat illustration',
        referenceImages: [{ mimeType: 'image/png', data: image }],
        count: 2,
        seed: 42,
        size: '1024x1024'
      },
      { requestId: 'req-image-1' }
    )

    expect(result.images).toHaveLength(2)
    expect(result.images[0]!.width).toBe(8)
    expect(result.images[0]!.height).toBe(8)
    expect(result.images[0]!.sha256).toHaveLength(64)
    const body = JSON.parse(server.requests[0]!.body.toString('utf8'))
    expect(body).toMatchObject({
      model: 'test-seedream-model',
      prompt: 'a flat illustration',
      size: '1024x1024',
      seed: 42,
      response_format: 'url',
      watermark: false,
      sequential_image_generation: 'auto',
      sequential_image_generation_options: { max_images: 2 }
    })
    expect(body.image[0]).toMatch(/^data:image\/png;base64,/)
    expect(server.requests[0]!.headers.authorization).toBe('Bearer seedream-secret')
  })

  it('maps content policy rejection without leaking inputs', async () => {
    server = await startTestServer((_request, response) => {
      sendJson(response, 400, { error: { code: 'content_policy', message: 'sensitive prompt' } })
    })
    let error: unknown
    try {
      await provider(`${server.url}/v1`).generate(
        {
          prompt: 'secret prompt',
          size: '1024x1024'
        },
        { requestId: 'req-image-2' }
      )
    } catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({ code: 'PROVIDER_CONTENT_REJECTED' })
    expect(JSON.stringify(error)).not.toContain('seedream-secret')
    expect(String(error)).not.toContain('secret prompt')
  })

  it('omits sequential generation options for a single image', async () => {
    server = await startTestServer((request, response) => {
      if (request.method === 'POST') {
        sendJson(response, 400, { error: { code: 'invalid', message: 'diagnostic only' } })
      } else {
        response.writeHead(404).end()
      }
    })

    await expect(
      provider(`${server.url}/v1`).generate(
        {
          prompt: 'single image probe',
          size: '1024x1024',
          count: 1
        },
        { requestId: 'req-image-single' }
      )
    ).rejects.toMatchObject({ code: 'PROVIDER_INVALID_REQUEST' })

    const body = JSON.parse(server.requests[0]!.body.toString('utf8'))
    expect(body).not.toHaveProperty('sequential_image_generation')
    expect(body).not.toHaveProperty('sequential_image_generation_options')
  })

  it('rejects invalid size, count, and oversized reference sets', async () => {
    server = await startTestServer((_request, response) => sendJson(response, 500, {}))
    await expect(
      provider(`${server.url}/v1`).generate(
        {
          prompt: 'x',
          size: 'huge'
        },
        { requestId: 'req-image-3' }
      )
    ).rejects.toMatchObject({ code: 'PROVIDER_INVALID_REQUEST' })
    await expect(
      provider(`${server.url}/v1`).generate(
        {
          prompt: 'x',
          size: '1024x1024',
          count: 0
        },
        { requestId: 'req-image-4' }
      )
    ).rejects.toMatchObject({ code: 'PROVIDER_INVALID_REQUEST' })
    await expect(
      provider(`${server.url}/v1`).generate(
        {
          prompt: 'x',
          size: '1024x1024',
          referenceImages: Array.from({ length: 15 }, () => ({
            mimeType: 'image/png' as const,
            data: Buffer.from([1])
          }))
        },
        { requestId: 'req-image-5' }
      )
    ).rejects.toMatchObject({ code: 'PROVIDER_INVALID_REQUEST' })
  })

  it('maps download failures to invalid response', async () => {
    server = await startTestServer((request, response) => {
      if (request.method === 'POST') {
        sendJson(response, 200, { data: [{ url: `${server!.url}/not-image` }] })
      } else {
        response.writeHead(200, { 'content-type': 'text/plain' })
        response.end('not an image')
      }
    })
    await expect(
      provider(`${server.url}/v1`).generate(
        {
          prompt: 'x',
          size: '1024x1024'
        },
        { requestId: 'req-image-6' }
      )
    ).rejects.toMatchObject({
      code: 'PROVIDER_INVALID_RESPONSE'
    })
  })
})
