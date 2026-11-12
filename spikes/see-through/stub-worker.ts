import { createHash, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { buildFixturePsd, FIXTURE_HEIGHT, FIXTURE_LAYER_NAMES, FIXTURE_WIDTH } from '../psd2live/lib/fixture'
import {
  SEE_THROUGH_MAX_IMAGE_BYTES,
  SEE_THROUGH_PROTOCOL_VERSION,
  createJobRequestSchema,
  type JobResponse
} from '../../packages/contracts/src/see-through'

export interface StubWorker {
  url: string
  close(): Promise<void>
}

interface Upload {
  bytes: Buffer
  sha256: string
  contentType: string
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly closeAfterResponse = false
  ) {
    super(message)
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  sendJson(response, status, 'application/json; charset=utf-8', body)
}

function sendJson(response: ServerResponse, status: number, contentType: string, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body))
  response.writeHead(status, {
    'content-type': contentType,
    'content-length': payload.length
  })
  response.end(payload)
}

function problem(response: ServerResponse, error: HttpError, requestId?: string): void {
  sendJson(response, error.status, 'application/problem+json; charset=utf-8', {
    type: 'about:blank',
    title: error.code,
    status: error.status,
    code: error.code,
    detail: error.message,
    ...(requestId ? { requestId } : {})
  })
}

function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const declaredHeader = request.headers['content-length']
  if (declaredHeader !== undefined) {
    const declared = Number(declaredHeader)
    if (!Number.isSafeInteger(declared) || declared < 0) {
      return Promise.reject(new HttpError(400, 'SEE_THROUGH_INVALID_INPUT', 'invalid content-length'))
    }
    if (declared > limit) {
      // Reject without destroying the socket: drain the announced body so the
      // client can finish writing and read the flushed 413 problem response.
      request.resume()
      return Promise.reject(new HttpError(413, 'SEE_THROUGH_PAYLOAD_TOO_LARGE', 'payload too large'))
    }
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    const cleanup = (): void => {
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', onError)
    }
    const onData = (chunk: Buffer): void => {
      if (settled) return
      total += chunk.length
      if (total > limit) {
        settled = true
        cleanup()
        request.pause()
        reject(new HttpError(413, 'SEE_THROUGH_PAYLOAD_TOO_LARGE', 'payload too large', true))
        return
      }
      chunks.push(chunk)
    }
    const onEnd = (): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(Buffer.concat(chunks))
    }
    const onError = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    request.on('data', onData)
    request.on('end', onEnd)
    request.on('error', onError)
  })
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const bytes = await readBody(request, 64 * 1024)
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown
  } catch {
    throw new HttpError(400, 'SEE_THROUGH_INVALID_INPUT', 'invalid JSON')
  }
}

function now(): string {
  return new Date().toISOString()
}

export async function startStubWorker(options: { token: string }): Promise<StubWorker> {
  if (!options.token) throw new Error('STUB_TOKEN_REQUIRED')
  const uploads = new Map<string, Upload>()
  const jobs = new Map<string, JobResponse>()
  const results = new Map<string, Buffer>()
  const requestIds = new Map<string, { jobId: string; sha256: string }>()

  const server: Server = createServer(async (request, response) => {
    try {
      if (request.headers.authorization !== `Bearer ${options.token}`) {
        throw new HttpError(401, 'SEE_THROUGH_UNAUTHORIZED', 'missing or invalid token')
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')

      if (request.method === 'GET' && url.pathname === '/v1/health') {
        json(response, 200, {
          ok: true,
          protocolVersion: SEE_THROUGH_PROTOCOL_VERSION,
          workerVersion: 'stub-0.1.0',
          gpu: null,
          models: { seeThrough: 'stub' }
        })
        return
      }

      if (request.method === 'POST' && url.pathname === '/v1/uploads') {
        const contentType = request.headers['content-type']
        if (contentType !== 'image/png' && contentType !== 'image/jpeg' && contentType !== 'image/webp') {
          throw new HttpError(415, 'SEE_THROUGH_UNSUPPORTED_MEDIA', 'unsupported image type')
        }
        const bytes = await readBody(request, SEE_THROUGH_MAX_IMAGE_BYTES)
        if (bytes.length === 0) throw new HttpError(400, 'SEE_THROUGH_INVALID_INPUT', 'empty upload')
        const actual = createHash('sha256').update(bytes).digest('hex')
        const expected = request.headers['x-content-sha256']
        if (expected !== actual) {
          throw new HttpError(400, 'SEE_THROUGH_CHECKSUM_MISMATCH', 'upload sha256 mismatch')
        }
        const uploadId = randomUUID()
        uploads.set(uploadId, { bytes, sha256: actual, contentType })
        json(response, 201, { uploadId, sha256: actual, byteSize: bytes.length, contentType })
        return
      }

      if (request.method === 'POST' && url.pathname === '/v1/jobs') {
        const parsed = createJobRequestSchema.safeParse(await readJson(request))
        if (!parsed.success) {
          throw new HttpError(
            400,
            'SEE_THROUGH_INVALID_INPUT',
            parsed.error.issues[0]?.message ?? 'invalid request'
          )
        }
        const input = parsed.data
        const upload = uploads.get(input.uploadId)
        if (!upload || upload.sha256 !== input.sha256) {
          throw new HttpError(400, 'SEE_THROUGH_INVALID_INPUT', 'unknown upload or sha mismatch')
        }
        const existing = requestIds.get(input.requestId)
        if (existing) {
          if (existing.sha256 !== input.sha256) {
            throw new HttpError(
              409,
              'SEE_THROUGH_IDEMPOTENCY_CONFLICT',
              'requestId reused with another image'
            )
          }
          json(response, 200, jobs.get(existing.jobId))
          return
        }

        const id = randomUUID()
        const createdAt = now()
        const job: JobResponse = {
          protocolVersion: SEE_THROUGH_PROTOCOL_VERSION,
          id,
          requestId: input.requestId,
          status: 'queued',
          createdAt,
          updatedAt: createdAt,
          result: null,
          error: null
        }
        jobs.set(id, job)
        requestIds.set(input.requestId, { jobId: id, sha256: input.sha256 })
        json(response, 202, job)

        setTimeout(() => {
          job.status = 'running'
          job.updatedAt = now()
          setTimeout(() => {
            const psd = buildFixturePsd({ naming: 'upper' })
            const sha256 = createHash('sha256').update(psd).digest('hex')
            results.set(id, psd)
            job.status = 'succeeded'
            job.updatedAt = now()
            job.result = {
              psd: { sha256, byteSize: psd.length, downloadPath: `/v1/jobs/${id}/result` },
              width: FIXTURE_WIDTH,
              height: FIXTURE_HEIGHT,
              metrics: {
                elapsedMs: 0,
                peakVramMiB: null,
                missingRequiredRoles: [],
                composite: { alphaIou: 1, deltaE2000P95: 0 },
                manualInterventionCount: 0
              },
              layers: FIXTURE_LAYER_NAMES('upper').map((name) => ({
                name,
                role: null,
                bbox: null,
                visible: true
              }))
            }
          }, 10)
        }, 10)
        return
      }

      const jobMatch = /^\/v1\/jobs\/([^/]+)$/.exec(url.pathname)
      if (request.method === 'GET' && jobMatch) {
        const job = jobs.get(jobMatch[1]!)
        if (!job) throw new HttpError(404, 'SEE_THROUGH_JOB_NOT_FOUND', 'job not found')
        json(response, 200, job)
        return
      }

      const resultMatch = /^\/v1\/jobs\/([^/]+)\/result$/.exec(url.pathname)
      if (request.method === 'GET' && resultMatch) {
        const id = resultMatch[1]!
        const job = jobs.get(id)
        const bytes = results.get(id)
        if (!job || !bytes) throw new HttpError(404, 'SEE_THROUGH_RESULT_NOT_READY', 'result not ready')
        response.writeHead(200, {
          'content-type': 'image/vnd.adobe.photoshop',
          'content-length': bytes.length,
          'x-content-sha256': job.result!.psd.sha256
        })
        response.end(bytes)
        return
      }

      throw new HttpError(404, 'SEE_THROUGH_NOT_FOUND', 'not found')
    } catch (error) {
      const failure =
        error instanceof HttpError ? error : new HttpError(500, 'SEE_THROUGH_INTERNAL', 'internal error')
      problem(response, failure)
      if (failure.closeAfterResponse && !request.readableEnded) {
        // Streaming overflow: flush the problem response first so the paused,
        // unconsumed request cannot reset the socket before the client sees it.
        response.once('finish', () => request.destroy())
      }
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('STUB_BIND_FAILED')
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      const closed = new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
      server.closeAllConnections()
      await closed
    }
  }
}
