import { z } from 'zod'

export const SEE_THROUGH_PROTOCOL_VERSION = 1 as const
export const SEE_THROUGH_MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const SEE_THROUGH_MAX_PSD_BYTES = 200 * 1024 * 1024

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const contentTypeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp'])
const rfc3339Schema = z.string().datetime({ offset: true })

export const seeThroughLayerSchema = z
  .object({
    name: z.string().min(1).max(128),
    role: z.string().min(1).max(64).nullable(),
    bbox: z
      .tuple([
        z.number().int().nonnegative(),
        z.number().int().nonnegative(),
        z.number().int().positive(),
        z.number().int().positive()
      ])
      .nullable(),
    visible: z.boolean()
  })
  .strict()

export type SeeThroughLayer = z.infer<typeof seeThroughLayerSchema>

export const requiredSeeThroughRoleSchema = z.enum(['face', 'eyes', 'mouth', 'hair', 'body', 'clothing'])

export const uploadResponseSchema = z
  .object({
    uploadId: z.string().min(1).max(128),
    sha256: sha256Schema,
    byteSize: z.number().int().positive().max(SEE_THROUGH_MAX_IMAGE_BYTES),
    contentType: contentTypeSchema
  })
  .strict()

export const createJobRequestSchema = z
  .object({
    protocolVersion: z.literal(SEE_THROUGH_PROTOCOL_VERSION),
    requestId: z.string().min(1).max(128),
    uploadId: z.string().min(1).max(128),
    sha256: sha256Schema,
    options: z
      .object({
        maxLayers: z.number().int().min(2).max(64).optional(),
        layerNaming: z.enum(['psd2live', 'generic']).optional()
      })
      .strict()
      .optional()
  })
  .strict()

export const seeThroughJobStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled'])

export const jobResponseSchema = z
  .object({
    protocolVersion: z.literal(SEE_THROUGH_PROTOCOL_VERSION),
    id: z.string().min(1).max(128),
    requestId: z.string().min(1).max(128),
    status: seeThroughJobStatusSchema,
    createdAt: rfc3339Schema,
    updatedAt: rfc3339Schema,
    result: z
      .object({
        psd: z
          .object({
            sha256: sha256Schema,
            byteSize: z.number().int().positive().max(SEE_THROUGH_MAX_PSD_BYTES),
            downloadPath: z.string().startsWith('/')
          })
          .strict(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        metrics: z
          .object({
            elapsedMs: z.number().int().nonnegative(),
            peakVramMiB: z.number().int().positive().nullable(),
            missingRequiredRoles: z.array(requiredSeeThroughRoleSchema),
            composite: z
              .object({
                alphaIou: z.number().min(0).max(1),
                deltaE2000P95: z.number().nonnegative()
              })
              .strict(),
            manualInterventionCount: z.number().int().nonnegative()
          })
          .strict(),
        layers: z.array(seeThroughLayerSchema).min(1).max(256)
      })
      .strict()
      .nullable(),
    error: z
      .object({
        code: z.string().min(1).max(128),
        message: z.string().min(1).max(1024)
      })
      .strict()
      .nullable()
  })
  .strict()

export const healthResponseSchema = z
  .object({
    ok: z.literal(true),
    protocolVersion: z.literal(SEE_THROUGH_PROTOCOL_VERSION),
    workerVersion: z.string().min(1).max(128),
    gpu: z
      .object({
        name: z.string().min(1).max(256),
        cudaVersion: z.string().min(1).max(64),
        vramMiB: z.number().int().positive()
      })
      .strict()
      .nullable(),
    models: z
      .object({
        seeThrough: z.string().min(1).max(128)
      })
      .strict()
  })
  .strict()

export const problemSchema = z
  .object({
    type: z.string().max(256),
    title: z.string().min(1).max(256),
    status: z.number().int().min(400).max(599),
    code: z.string().min(1).max(128),
    detail: z.string().max(1024).optional(),
    requestId: z.string().max(128).optional()
  })
  .strict()

export type UploadResponse = z.infer<typeof uploadResponseSchema>
export type CreateJobRequest = z.infer<typeof createJobRequestSchema>
export type JobResponse = z.infer<typeof jobResponseSchema>
export type HealthResponse = z.infer<typeof healthResponseSchema>
export type SeeThroughProblem = z.infer<typeof problemSchema>
