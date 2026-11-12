import { describe, expect, it } from 'vitest'
import {
  createJobRequestSchema,
  healthResponseSchema,
  jobResponseSchema,
  uploadResponseSchema
} from './see-through'

const SHA = 'a'.repeat(64)
const NOW = '2026-11-09T10:00:00.000Z'

describe('see-through v1 contract', () => {
  it('accepts a strict upload response', () => {
    expect(
      uploadResponseSchema.parse({
        uploadId: 'upload-1',
        sha256: SHA,
        byteSize: 1234,
        contentType: 'image/png'
      })
    ).toMatchObject({ uploadId: 'upload-1' })
  })

  it('rejects unknown fields and invalid hashes', () => {
    expect(
      createJobRequestSchema.safeParse({
        protocolVersion: 1,
        requestId: 'req-1',
        uploadId: 'upload-1',
        sha256: SHA,
        options: { maxLayers: 20 },
        unexpected: true
      }).success
    ).toBe(false)
    expect(
      createJobRequestSchema.safeParse({
        protocolVersion: 1,
        requestId: 'req-1',
        uploadId: 'upload-1',
        sha256: SHA.toUpperCase()
      }).success
    ).toBe(false)
  })

  it('accepts succeeded and failed jobs', () => {
    const base = {
      protocolVersion: 1,
      id: 'job-1',
      requestId: 'req-1',
      createdAt: NOW,
      updatedAt: NOW
    }
    expect(
      jobResponseSchema.parse({
        ...base,
        status: 'succeeded',
        result: {
          psd: { sha256: SHA, byteSize: 4096, downloadPath: '/v1/jobs/job-1/result' },
          width: 800,
          height: 1000,
          metrics: {
            elapsedMs: 1200,
            peakVramMiB: 4096,
            missingRequiredRoles: [],
            composite: { alphaIou: 0.997, deltaE2000P95: 1.8 },
            manualInterventionCount: 0
          },
          layers: [{ name: 'FACE', role: null, bbox: [0, 0, 800, 1000], visible: true }]
        },
        error: null
      }).status
    ).toBe('succeeded')
    expect(
      jobResponseSchema.parse({
        ...base,
        status: 'failed',
        result: null,
        error: { code: 'SEE_THROUGH_JOB_FAILED', message: 'CUDA out of memory' }
      }).status
    ).toBe('failed')
  })

  it('requires a GPU-aware health payload', () => {
    expect(
      healthResponseSchema.parse({
        ok: true,
        protocolVersion: 1,
        workerVersion: '0.1.0',
        gpu: { name: 'NVIDIA RTX 4090', cudaVersion: '12.4', vramMiB: 24564 },
        models: { seeThrough: 'v1' }
      }).ok
    ).toBe(true)
  })
})
