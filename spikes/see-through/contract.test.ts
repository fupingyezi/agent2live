import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readPsd } from 'ag-psd'
import { randomUUID } from 'node:crypto'
import { problemSchema } from '../../packages/contracts/src/see-through'
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
})
