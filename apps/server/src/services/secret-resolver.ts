import { AppError } from '../errors'

export interface SecretResolver {
  resolve(secretRef: string): Promise<string>
  redact(value: string): string
}

export class StaticSecretResolver implements SecretResolver {
  constructor(private readonly values: Map<string, string>) {}

  async resolve(secretRef: string): Promise<string> {
    const value = this.values.get(secretRef)
    if (!value) throw new AppError('PROVIDER_NOT_CONFIGURED', {})
    return value
  }

  redact(value: string): string {
    let out = value
    for (const secret of this.values.values()) {
      if (secret && secret.length >= 4) out = out.split(secret).join('[REDACTED]')
    }
    return out
  }
}

export interface SecretBrokerMessage {
  type: 'secret.request' | 'secret.response'
  id: string
  secretRef?: string
  value?: string | null
  error?: string
}
