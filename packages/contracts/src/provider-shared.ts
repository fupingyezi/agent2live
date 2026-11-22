import { z } from 'zod'

export function isBlockedProviderHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === '169.254.169.254' || host.endsWith('.local') || host === 'metadata.google.internal') {
    return true
  }
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    return true
  }
  if (/^(fc|fd|fe80):/i.test(host)) return true
  return false
}

export const providerBaseUrlSchema = z
  .string()
  .url()
  .max(500)
  .refine(
    (value) => {
      let url: URL
      try {
        url = new URL(value)
      } catch {
        return false
      }
      if (url.username || url.password) return false
      if (isBlockedProviderHost(url.hostname)) return false
      return (
        url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      )
    },
    { message: 'provider URL must use HTTPS or loopback HTTP' }
  )

export const providerSecretRefSchema = z.string().regex(/^sec_[0-9A-HJKMNP-TV-Z]{26}$/)
