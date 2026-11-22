import { afterEach, describe, expect, it } from 'vitest'
import { discoverModels } from '../src/model-discovery'
import { sendJson, startTestServer, type TestServer } from './helpers'

let server: TestServer | null = null
afterEach(async () => {
  await server?.close()
  server = null
})

async function discoverResponse(payload: unknown) {
  server = await startTestServer((_request, response) => sendJson(response, 200, payload))
  return discoverModels({
    baseUrl: `${server.url}/v1`,
    apiKey: 'sk-test',
    flavor: 'ark',
    requestId: 'req-models'
  })
}

describe('model discovery', () => {
  it('maps Ark LLM/VLM to chat and ImageGeneration to image, dropping other domains', async () => {
    const profiles = await discoverResponse({
      data: [
        {
          id: 'doubao-seed-1-6',
          name: 'Doubao Seed',
          domain: 'VLM',
          modalities: { input_modalities: ['text', 'image'], output_modalities: ['text'] }
        },
        { id: 'doubao-pro', domain: 'LLM' },
        { id: 'doubao-seedream-5-0-pro', name: 'Seedream', domain: 'ImageGeneration' },
        { id: 'doubao-seedance', domain: 'VideoGeneration' },
        { id: 'doubao-embedding', domain: 'Embedding' }
      ]
    })
    expect(profiles.map((profile) => [profile.id, profile.kind, profile.adapter])).toEqual([
      ['doubao-seed-1-6', 'chat', 'openai-compatible'],
      ['doubao-pro', 'chat', 'openai-compatible'],
      ['doubao-seedream-5-0-pro', 'image', 'seedream']
    ])
    expect(profiles[0]!.capabilities.chat?.supportsVision).toBe(true)
    expect(profiles[1]!.capabilities.chat?.supportsVision).toBe(false)
    expect(profiles[2]!.capabilities.image?.maxCount).toBe(4)
    expect(server!.requests[0]!.headers.authorization).toBe('Bearer sk-test')
    expect(JSON.stringify(profiles)).not.toContain('sk-test')
  })

  it('filters Zhipu non-chat families and marks chat vision', async () => {
    server = await startTestServer((_request, response) =>
      sendJson(response, 200, {
        data: [{ id: 'glm-5.3-flash', name: 'GLM 5.3 Flash' }, { id: 'cogview-4' }, { id: 'embedding-3' }]
      })
    )
    const profiles = await discoverModels({
      baseUrl: `${server.url}/v1`,
      apiKey: 'sk-test',
      flavor: 'zhipu',
      requestId: 'req-zhipu'
    })
    expect(profiles.map((profile) => profile.id)).toEqual(['glm-5.3-flash'])
    expect(profiles[0]!.capabilities.chat).toMatchObject({ supportsVision: true, maxImages: 6 })
  })

  it('uses DeepSeek output/input modalities', async () => {
    server = await startTestServer((_request, response) =>
      sendJson(response, 200, {
        data: [
          {
            id: 'deepseek-flash',
            name: 'DeepSeek Flash',
            input_modalities: ['text', 'image'],
            output_modalities: ['text']
          },
          { id: 'deepseek-embedding', output_modalities: ['embedding'] }
        ]
      })
    )
    const profiles = await discoverModels({
      baseUrl: `${server.url}/v1`,
      apiKey: 'sk-test',
      flavor: 'deepseek',
      requestId: 'req-deepseek'
    })
    expect(profiles.map((profile) => profile.id)).toEqual(['deepseek-flash'])
    expect(profiles[0]!.capabilities.chat?.supportsVision).toBe(true)
  })

  it('maps custom chat and narrows custom image to Seedream-compatible families', async () => {
    server = await startTestServer((_request, response) =>
      sendJson(response, 200, {
        data: [{ id: 'my-chat-model' }, { id: 'gpt-image-1' }, { id: 'text-embedding-3' }]
      })
    )
    const chat = await discoverModels({
      baseUrl: `${server.url}/v1`,
      apiKey: 'sk-test',
      flavor: 'custom-chat',
      requestId: 'req-custom-chat'
    })
    expect(chat.map((profile) => profile.id)).toEqual(['my-chat-model'])
    server = null
    server = await startTestServer((_request, response) =>
      sendJson(response, 200, {
        data: [
          { id: 'my-chat-model' },
          { id: 'gpt-image-1' },
          { id: 'flux-1.1-pro' },
          { id: 'seedream-4' },
          { id: 'seededit-3-0' }
        ]
      })
    )
    const image = await discoverModels({
      baseUrl: `${server.url}/v1`,
      apiKey: 'sk-test',
      flavor: 'custom-image',
      requestId: 'req-custom-image'
    })
    expect(image.map((profile) => profile.id)).toEqual(['seedream-4', 'seededit-3-0'])
    expect(image.every((profile) => profile.adapter === 'seedream')).toBe(true)
  })

  it('maps 404 to PROVIDER_MODELS_UNSUPPORTED and rejects invalid bodies', async () => {
    server = await startTestServer((_request, response) =>
      sendJson(response, 404, { error: { code: 'not_found' } })
    )
    await expect(
      discoverModels({
        baseUrl: `${server.url}/v1`,
        apiKey: 'sk-test',
        flavor: 'custom-chat',
        requestId: 'req-404'
      })
    ).rejects.toMatchObject({ code: 'PROVIDER_MODELS_UNSUPPORTED' })

    server = null
    server = await startTestServer((_request, response) => sendJson(response, 200, { items: [] }))
    await expect(
      discoverModels({
        baseUrl: `${server.url}/v1`,
        apiKey: 'sk-test',
        flavor: 'custom-chat',
        requestId: 'req-invalid'
      })
    ).rejects.toMatchObject({ code: 'PROVIDER_INVALID_RESPONSE' })
  })
})
