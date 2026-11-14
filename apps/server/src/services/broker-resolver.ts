import { randomUUID } from 'node:crypto'
import { AppError } from '../errors'
import type { SecretResolver } from './secret-resolver'

export interface BrokerPort {
  postMessage(message: unknown): void
  onMessage(listener: (message: unknown) => void): void
}

interface Pending {
  resolve: (value: string) => void
  reject: (error: unknown) => void
  timer: NodeJS.Timeout
}

export class BrokerSecretResolver implements SecretResolver {
  private readonly pending = new Map<string, Pending>()
  private readonly secrets = new Set<string>()

  constructor(
    private readonly port: BrokerPort,
    private readonly timeoutMs = 5000
  ) {
    port.onMessage((message) => this.onMessage(message))
  }

  async resolve(secretRef: string): Promise<string> {
    const id = randomUUID()
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new AppError('PROVIDER_NOT_CONFIGURED', {}))
      }, this.timeoutMs)
      timer.unref()
      this.pending.set(id, { resolve, reject, timer })
      this.port.postMessage({ type: 'secret.request', id, secretRef })
    })
  }

  redact(value: string): string {
    let out = value
    for (const secret of this.secrets) out = out.split(secret).join('[REDACTED]')
    return out
  }

  private onMessage(raw: unknown): void {
    const message = raw as { type?: string; id?: string; value?: string | null; error?: string }
    if (message.type !== 'secret.response' || !message.id) return
    const pending = this.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(message.id)
    if (typeof message.value === 'string' && message.value.length > 0) {
      this.secrets.add(message.value)
      pending.resolve(message.value)
    } else {
      pending.reject(new AppError('PROVIDER_NOT_CONFIGURED', {}))
    }
  }
}
