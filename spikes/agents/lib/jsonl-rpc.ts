import { EventEmitter } from 'node:events'
import { createInterface, type Interface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

type JsonObject = Record<string, unknown>

export interface RpcNotification {
  method: string
  params?: unknown
}

export interface RpcServerRequest {
  id: number | string
  method: string
  params?: unknown
}

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: NodeJS.Timeout
}

export class JsonlRpcClient extends EventEmitter {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly outbox: JsonObject[] = []
  private readonly lines: Interface
  private flushScheduled = false
  private closed = false

  /**
   * `writable` is the outbound side (the server process's stdin); `readable`
   * is the inbound side (its stdout).
   */
  constructor(
    private readonly writable: Writable,
    readable: Readable
  ) {
    super()
    this.lines = createInterface({ input: readable, crlfDelay: Infinity })
    this.lines.on('line', (line) => this.onLine(line))
    readable.once('close', () => this.close())
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = 60_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error('RPC_CLOSED'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC_TIMEOUT:${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      this.write({ id, method, ...(params === undefined ? {} : { params }) })
    })
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return
    this.write({ method, ...(params === undefined ? {} : { params }) })
  }

  respond(id: number | string, result: unknown): void {
    if (this.closed) return
    this.write({ id, result })
  }

  respondError(id: number | string, code: number, message: string): void {
    if (this.closed) return
    this.write({ id, error: { code, message } })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.outbox.length = 0
    this.lines.close()
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('RPC_CLOSED'))
    }
    this.pending.clear()
    this.emit('closed')
  }

  /**
   * Messages are queued and flushed one per event-loop turn. This keeps each
   * JSONL message in its own readable chunk so line-oriented consumers can
   * parse them one at a time; ordering is preserved by the FIFO outbox.
   */
  private write(message: JsonObject): void {
    this.outbox.push(message)
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.flushScheduled || this.closed) return
    this.flushScheduled = true
    setImmediate(() => {
      this.flushScheduled = false
      if (this.closed) return
      const next = this.outbox.shift()
      if (next === undefined) return
      this.writable.write(`${JSON.stringify(next)}\n`)
      if (this.outbox.length > 0) this.scheduleFlush()
    })
  }

  private onLine(line: string): void {
    const text = line.trim()
    if (!text) return
    let message: JsonObject
    try {
      const parsed = JSON.parse(text) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
      message = parsed as JsonObject
    } catch {
      this.emit('protocolError', new Error('RPC_INVALID_JSON'))
      return
    }

    if (message.id !== undefined && typeof message.method === 'string') {
      this.emit('serverRequest', {
        id: message.id as number | string,
        method: message.method,
        params: message.params
      } satisfies RpcServerRequest)
      return
    }

    if (message.id !== undefined) {
      const id = message.id
      if (typeof id !== 'number') return
      const pending = this.pending.get(id)
      if (!pending) return
      this.pending.delete(id)
      clearTimeout(pending.timer)
      if (message.error !== undefined) {
        const error = message.error as { code?: unknown }
        pending.reject(
          new Error(`RPC_REMOTE_ERROR:${typeof error.code === 'number' ? error.code : 'unknown'}`)
        )
      } else {
        pending.resolve(message.result)
      }
      return
    }

    if (typeof message.method === 'string') {
      this.emit('notification', {
        method: message.method,
        params: message.params
      } satisfies RpcNotification)
    }
  }
}
