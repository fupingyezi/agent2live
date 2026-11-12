import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readPsd } from 'ag-psd'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import {
  SEE_THROUGH_MAX_IMAGE_BYTES,
  SEE_THROUGH_MAX_PSD_BYTES,
  problemSchema,
  type JobResponse
} from '../../packages/contracts/src/see-through'
import { FIXTURE_LAYER_NAMES } from '../psd2live/lib/fixture'
import { SeeThroughClient, SeeThroughClientError } from './client'
import { startStubWorker, type StubWorker } from './stub-worker'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lYQ0TQAAAABJRU5ErkJggg==',
  'base64'
)

describe('see-through stub contract', () => {
  let worker: StubWorker
  let client: SeeThroughClient

  beforeAll(async () => {
    worker = await startStubWorker({ token: 'test-token' })
    client = new SeeThroughClient(worker.url, 'test-token')
  })

  afterAll(async () => {
    await worker.close()
  })

  it('reports health', async () => {
    const health = await client.health()
    expect(health.protocolVersion).toBe(1)
    expect(health.gpu).toBeNull()
  })

  it('rejects a bad token', async () => {
    const unauthorized = new SeeThroughClient(worker.url, 'wrong-token')
    await expect(unauthorized.health()).rejects.toMatchObject({
      code: 'SEE_THROUGH_UNAUTHORIZED',
      status: 401
    } satisfies Partial<SeeThroughClientError>)
  })

  it('uses problem+json for errors and application/json for success', async () => {
    const success = await fetch(`${worker.url}/v1/health`, {
      headers: { authorization: 'Bearer test-token' }
    })
    expect(success.status).toBe(200)
    expect(success.headers.get('content-type')).toBe('application/json; charset=utf-8')
    await success.arrayBuffer()

    const failure = await fetch(`${worker.url}/v1/health`, {
      headers: { authorization: 'Bearer wrong-token' }
    })
    expect(failure.status).toBe(401)
    expect(failure.headers.get('content-type')).toBe('application/problem+json; charset=utf-8')
    expect(problemSchema.parse(await failure.json()).code).toBe('SEE_THROUGH_UNAUTHORIZED')
  })

  it('runs upload → job → result and returns a parsable layered PSD', async () => {
    const job = await client.submit(PNG, `req-${randomUUID()}`)
    const finished = await client.waitForJob(job.id, 10_000)
    expect(finished.status).toBe('succeeded')
    expect(finished.result?.layers.map((layer) => layer.name)).toEqual(FIXTURE_LAYER_NAMES('upper'))

    const bytes = await client.downloadResult(finished)
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('8BPS')
    const psd = readPsd(bytes, {
      useImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true
    })
    expect(psd.children?.length).toBe(20)
  })

  it('deduplicates requestId and rejects reuse with another image', async () => {
    const requestId = `req-${randomUUID()}`
    const first = await client.submit(PNG, requestId)
    const second = await client.submit(PNG, requestId)
    expect(second.id).toBe(first.id)

    const otherPng = Buffer.concat([PNG, Buffer.from([0])])
    await expect(client.submit(otherPng, requestId)).rejects.toMatchObject({
      code: 'SEE_THROUGH_IDEMPOTENCY_CONFLICT',
      status: 409
    })
  })

  it('rejects a checksum mismatch on upload', async () => {
    await expect(client.upload(PNG, '0'.repeat(64))).rejects.toMatchObject({
      code: 'SEE_THROUGH_CHECKSUM_MISMATCH',
      status: 400
    })
  })

  it('rejects an oversized upload with a 413 problem+json response', async () => {
    const oversized = Buffer.alloc(SEE_THROUGH_MAX_IMAGE_BYTES + 1, 1)
    await expect(client.upload(oversized)).rejects.toMatchObject({
      code: 'SEE_THROUGH_PAYLOAD_TOO_LARGE',
      status: 413,
      responseContentType: 'application/problem+json; charset=utf-8'
    } satisfies Partial<SeeThroughClientError>)
  })

  it('rejects an oversized JSON job body with a stable problem response', async () => {
    const response = await fetch(`${worker.url}/v1/jobs`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ padding: 'x'.repeat(70 * 1024) })
    })
    expect(response.status).toBe(413)
    expect(response.headers.get('content-type')).toBe('application/problem+json; charset=utf-8')
    expect(problemSchema.parse(await response.json()).code).toBe('SEE_THROUGH_PAYLOAD_TOO_LARGE')
  })

  it('rejects a chunked streaming body over the limit without resetting the response', async () => {
    const encoder = new TextEncoder()
    const response = await fetch(`${worker.url}/v1/jobs`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json'
      },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (let index = 0; index < 4; index++) {
            controller.enqueue(encoder.encode('x'.repeat(20 * 1024)))
          }
          controller.close()
        }
      }),
      duplex: 'half'
    } as RequestInit & { duplex: 'half' })
    expect(response.status).toBe(413)
    expect(response.headers.get('content-type')).toBe('application/problem+json; charset=utf-8')
    expect(problemSchema.parse(await response.json()).code).toBe('SEE_THROUGH_PAYLOAD_TOO_LARGE')
  })

  it('rejects an oversized PSD result before buffering it', async () => {
    const server = createServer((request, response) => {
      request.resume()
      response.writeHead(200, {
        'content-type': 'image/vnd.adobe.photoshop',
        'content-length': String(SEE_THROUGH_MAX_PSD_BYTES + 1)
      })
      response.flushHeaders()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('TEST_SERVER_BIND_FAILED')
    try {
      const capClient = new SeeThroughClient(`http://127.0.0.1:${address.port}`, 'test-token')
      const job: JobResponse = {
        protocolVersion: 1,
        id: 'job-cap',
        requestId: 'req-cap',
        status: 'succeeded',
        createdAt: '2026-11-09T10:00:00.000Z',
        updatedAt: '2026-11-09T10:00:00.000Z',
        result: {
          psd: { sha256: 'a'.repeat(64), byteSize: 1, downloadPath: '/v1/jobs/job-cap/result' },
          width: 1,
          height: 1,
          metrics: {
            elapsedMs: 0,
            peakVramMiB: null,
            missingRequiredRoles: [],
            composite: { alphaIou: 1, deltaE2000P95: 0 },
            manualInterventionCount: 0
          },
          layers: [{ name: 'FACE', role: null, bbox: null, visible: true }]
        },
        error: null
      }
      await expect(capClient.downloadResult(job)).rejects.toMatchObject({
        code: 'SEE_THROUGH_RESULT_INVALID',
        status: 502
      })
    } finally {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()))
      server.closeAllConnections()
      await closed
    }
  })
})
