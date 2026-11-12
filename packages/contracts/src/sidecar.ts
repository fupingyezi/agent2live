import { z } from 'zod'

export const sidecarInfoSchema = z.object({
  baseUrl: z.string().regex(/^http:\/\/127\.0\.0\.1:\d+$/),
  token: z.string().min(32),
  pid: z.number().int().positive()
})

export const sidecarEndpointFileSchema = sidecarInfoSchema
  .extend({
    schemaVersion: z.literal('endpoint/1'),
    startedAt: z.string().min(1)
  })
  .strict()

export type SidecarInfo = z.infer<typeof sidecarInfoSchema>
export type SidecarEndpointFile = z.infer<typeof sidecarEndpointFileSchema>

export function parseSidecarEndpoint(value: unknown): SidecarEndpointFile {
  return sidecarEndpointFileSchema.parse(value)
}
