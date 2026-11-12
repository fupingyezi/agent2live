import { createHash } from 'node:crypto'
import {
  SEE_THROUGH_MAX_PSD_BYTES,
  SEE_THROUGH_PROTOCOL_VERSION,
  healthResponseSchema,
  jobResponseSchema,
  problemSchema,
  uploadResponseSchema,
  type JobResponse,
  type UploadResponse
} from '../../packages/contracts/src/see-through'

export class SeeThroughClientError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly responseContentType: string | null = null
  ) {
    super(message)
  }
}

async function readCappedBody(response: Response, limit: number): Promise<Buffer> {
  const declaredHeader = response.headers.get('content-length')
  if (declaredHeader !== null) {
    const declared = Number(declaredHeader)
    if (!Number.isSafeInteger(declared) || declared < 0) {
      throw new SeeThroughClientError('SEE_THROUGH_RESULT_INVALID', 502, 'invalid result length')
    }
    if (declared > limit) {
      await response.body?.cancel()
      throw new SeeThroughClientError('SEE_THROUGH_RESULT_INVALID', 502, 'result exceeds size limit')
    }
  }
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      throw new SeeThroughClientError('SEE_THROUGH_RESULT_INVALID', 502, 'result exceeds size limit')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export class SeeThroughClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(init.headers ?? {})
      }
    })
    if (!response.ok) {
      const contentType = response.headers.get('content-type')
      const text = await response.text()
      try {
        const problem = problemSchema.parse(JSON.parse(text) as unknown)
        throw new SeeThroughClientError(
          problem.code,
          response.status,
          problem.detail ?? problem.title,
          contentType
        )
      } catch (error) {
        if (error instanceof SeeThroughClientError) throw error
        throw new SeeThroughClientError(
          'SEE_THROUGH_HTTP_ERROR',
          response.status,
          text.slice(0, 200),
          contentType
        )
      }
    }
    return response
  }

  async health() {
    const response = await this.request('/v1/health')
    return healthResponseSchema.parse(await response.json())
  }

  async upload(
    image: Buffer,
    expectedSha256 = createHash('sha256').update(image).digest('hex')
  ): Promise<UploadResponse> {
    const response = await this.request('/v1/uploads', {
      method: 'POST',
      headers: {
        'content-type': 'image/png',
        'x-content-sha256': expectedSha256
      },
      body: new Uint8Array(image)
    })
    return uploadResponseSchema.parse(await response.json())
  }

  async submit(image: Buffer, requestId: string): Promise<JobResponse> {
    const upload = await this.upload(image)
    const response = await this.request('/v1/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        protocolVersion: SEE_THROUGH_PROTOCOL_VERSION,
        requestId,
        uploadId: upload.uploadId,
        sha256: upload.sha256
      })
    })
    return jobResponseSchema.parse(await response.json())
  }

  async getJob(id: string): Promise<JobResponse> {
    const response = await this.request(`/v1/jobs/${encodeURIComponent(id)}`)
    return jobResponseSchema.parse(await response.json())
  }

  async waitForJob(id: string, timeoutMs = 10 * 60_000): Promise<JobResponse> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const job = await this.getJob(id)
      if (['succeeded', 'failed', 'cancelled'].includes(job.status)) return job
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new SeeThroughClientError('SEE_THROUGH_TIMEOUT', 504, 'job timed out')
  }

  async downloadResult(job: JobResponse): Promise<Buffer> {
    if (job.status !== 'succeeded' || !job.result) {
      throw new SeeThroughClientError('SEE_THROUGH_RESULT_NOT_READY', 409, 'job has no result')
    }
    const response = await this.request(job.result.psd.downloadPath)
    const bytes = await readCappedBody(response, SEE_THROUGH_MAX_PSD_BYTES)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== job.result.psd.sha256 || bytes.length !== job.result.psd.byteSize) {
      throw new SeeThroughClientError('SEE_THROUGH_RESULT_INVALID', 502, 'result checksum or size mismatch')
    }
    return bytes
  }
}
