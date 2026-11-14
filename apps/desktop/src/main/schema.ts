import { z } from 'zod'

export const secretStoreSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    value: z.string().min(1).max(8192)
  })
  .strict()

export const secretRefSchema = z
  .object({
    secretRef: z.string().regex(/^sec_[0-9A-HJKMNP-TV-Z]{26}$/)
  })
  .strict()
