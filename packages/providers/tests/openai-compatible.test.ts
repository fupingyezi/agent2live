import { afterEach, describe, expect, it } from 'vitest'
import { ProviderError } from '../src/errors'
import { OpenAIChatProvider } from '../src/openai-compatible'
import { sendJson, startTestServer, type TestServer } from './helpers'

let server: TestServer | null = null

afterEach(async () => {
  await server?.close()
  server = null
})

function provider(baseUrl: string): OpenAIChatProvider {
  return new OpenAIChatProvider({
    baseUrl,
    apiKey: 'test-secret-key',
    model: 'test-chat-model'
  })
}

describe('OpenAIChatProvider', () => {
  it('sends auth, model, and text messages; returns usage and request id', async () => {
    server = await startTestServer((request, response) => {
      response.setHeader('x-request-id', 'provider-req-1')
      sendJson(response, 200, {
        model: 'test-chat-model',
        choices: [{ message: { role: 'assistant', content: 'pong' } }],
        usage: { prompt_tokens: 7, completion_tokens: 2 }
      })
    })
    const result = await provider(`${server.url}/v1`).generate(
      {
        messages: [{ role: 'user', content: 'ping' }],
        temperature: 0.2,
        maxTokens: 32
      },
      { requestId: 'req-1' }
    )

    expect(result.text).toBe('pong')
    expect(result.providerRequestId).toBe('provider-req-1')
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 2 })
    expect(server.requests[0]!.headers.authorization).toBe('Bearer test-secret-key')
    const body = JSON.parse(server.requests[0]!.body.toString('utf8'))
    expect(body).toMatchObject({ model: 'test-chat-model', temperature: 0.2, max_tokens: 32 })
    expect(body.messages).toEqual([{ role: 'user', content: 'ping' }])
  })

  it('converts image parts to OpenAI image_url data URLs', async () => {
    server = await startTestServer((_request, response) => {
      sendJson(response, 200, { choices: [{ message: { content: 'ok' } }] })
    })
    const image = Buffer.from([1, 2, 3])
    await provider(`${server.url}/v1`).generate(
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'describe' },
              { type: 'image', mimeType: 'image/png', data: image }
            ]
          }
        ]
      },
      { requestId: 'req-2' }
    )

    const body = JSON.parse(server.requests[0]!.body.toString('utf8'))
    expect(body.messages[0].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${image.toString('base64')}` }
    })
  })

  it('requests JSON object mode when the caller requires structured output', async () => {
    server = await startTestServer((_request, response) => {
      sendJson(response, 200, { choices: [{ message: { content: '{}' } }] })
    })
    await provider(`${server.url}/v1`).generate(
      {
        messages: [{ role: 'user', content: 'return json' }],
        responseFormat: 'json'
      },
      { requestId: 'req-json' }
    )

    const body = JSON.parse(server.requests[0]!.body.toString('utf8'))
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('maps 429 with retry-after without leaking key or prompt', async () => {
    server = await startTestServer((_request, response) => {
      response.setHeader('retry-after', '2')
      sendJson(response, 429, { error: { message: 'slow down' } })
    })
    let error: unknown
    try {
      await provider(`${server.url}/v1`).generate(
        {
          messages: [{ role: 'user', content: 'secret prompt' }]
        },
        { requestId: 'req-3' }
      )
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(ProviderError)
    expect(error).toMatchObject({ code: 'PROVIDER_RATE_LIMITED', retryable: true, retryAfterMs: 2000 })
    expect(JSON.stringify(error)).not.toContain('test-secret-key')
    expect(String(error)).not.toContain('secret prompt')
  })

  it('maps timeout and cancellation', async () => {
    server = await startTestServer(async (_request, response) => {
      await new Promise((resolve) => setTimeout(resolve, 200))
      sendJson(response, 200, { choices: [{ message: { content: 'late' } }] })
    })
    await expect(
      provider(`${server.url}/v1`).generate(
        {
          messages: [{ role: 'user', content: 'x' }]
        },
        { requestId: 'req-4', timeoutMs: 20 }
      )
    ).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT'
    })

    const controller = new AbortController()
    controller.abort()
    await expect(
      provider(`${server.url}/v1`).generate(
        {
          messages: [{ role: 'user', content: 'x' }]
        },
        { requestId: 'req-5', signal: controller.signal }
      )
    ).rejects.toMatchObject({
      code: 'PROVIDER_CANCELLED'
    })
  })

  it('rejects malformed success bodies', async () => {
    server = await startTestServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"choices":[]}')
    })
    await expect(
      provider(`${server.url}/v1`).generate(
        {
          messages: [{ role: 'user', content: 'x' }]
        },
        { requestId: 'req-6' }
      )
    ).rejects.toMatchObject({
      code: 'PROVIDER_INVALID_RESPONSE'
    })
  })
})
