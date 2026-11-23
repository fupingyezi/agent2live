import { z } from 'zod'

export const localServiceInfoSchema = z.object({
  baseUrl: z.string().regex(/^http:\/\/127\.0\.0\.1:\d+$/),
  token: z.string().min(32),
  pid: z.number().int().positive()
})

export const localServiceEndpointFileSchema = localServiceInfoSchema
  .extend({
    schemaVersion: z.literal('endpoint/1'),
    startedAt: z.string().min(1)
  })
  .strict()

export type LocalServiceInfo = z.infer<typeof localServiceInfoSchema>
export type LocalServiceEndpointFile = z.infer<typeof localServiceEndpointFileSchema>

export function parseLocalServiceEndpoint(value: unknown): LocalServiceEndpointFile {
  return localServiceEndpointFileSchema.parse(value)
}
