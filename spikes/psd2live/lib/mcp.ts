import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

export interface JsonSchemaNode {
  type?: string | string[]
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  enum?: unknown[]
  description?: string
}

export interface ToolDescriptor {
  name: string
  description: string
  inputSchema: JsonSchemaNode
}

interface ToolCallResult {
  content?: Array<{ type: string; text?: string }>
  structuredContent?: unknown
  isError?: boolean
}

function textOf(result: ToolCallResult): string {
  return (result.content ?? [])
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text!)
    .join('\n')
}

export function parseToolPayload(result: ToolCallResult): unknown {
  if (result.isError) throw new Error(`MCP_TOOL_ERROR:${textOf(result) || 'unknown'}`)
  if (result.structuredContent !== undefined) return result.structuredContent
  const text = textOf(result)
  if (!text) throw new Error('MCP_EMPTY_RESULT')
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`MCP_INVALID_JSON:${text.slice(0, 200)}`)
  }
}

export function unwrapData(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') throw new Error('MCP_PAYLOAD_NOT_OBJECT')
  const object = payload as Record<string, unknown>
  if (object.ok === false) {
    const error = object.error as { code?: string; message?: string } | undefined
    throw new Error(`MCP_REJECTED:${error?.code ?? 'unknown'}:${error?.message ?? ''}`)
  }
  const data = object.data
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : object
}

export function requestProperties(schema: JsonSchemaNode): Record<string, JsonSchemaNode> {
  const request = schema.properties?.request
  return request?.properties ?? schema.properties ?? {}
}

export function filterRequest(
  schema: JsonSchemaNode,
  values: Record<string, unknown>
): Record<string, unknown> {
  const properties = requestProperties(schema)
  if (Object.keys(properties).length === 0) return values
  const request: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue
    if (key === 'request_id' || key in properties) request[key] = value
  }
  return request
}

export function buildJobRequest(
  schema: JsonSchemaNode,
  jobId: string,
  waitMs = 5_000
): Record<string, unknown> {
  const properties = requestProperties(schema)
  const idKey = ['job_id', 'jobId', 'id', 'job'].find((key) => key in properties) ?? 'id'
  const request: Record<string, unknown> = { [idKey]: jobId }
  if ('wait_ms' in properties) request.wait_ms = waitMs
  if ('timeout_ms' in properties) request.timeout_ms = waitMs
  return request
}

export function pickCubismTarget(schema: JsonSchemaNode, version: '4.2' | '5.0'): string | null {
  const values = requestProperties(schema).target?.enum ?? []
  const wanted = version === '4.2' ? '42' : '50'
  for (const value of values) {
    if (typeof value !== 'string') continue
    const compact = value.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (compact.includes('cubism') && compact.includes(wanted)) return value
  }
  return null
}

export function isTerminalJob(data: Record<string, unknown>): boolean {
  const status = String(data.status ?? '').toLowerCase()
  if (['succeeded', 'completed', 'success', 'failed', 'error', 'cancelled', 'canceled'].includes(status)) {
    return true
  }
  return data.result !== undefined
}

function jobResult(data: Record<string, unknown>): Record<string, unknown> {
  return data.result && typeof data.result === 'object' ? (data.result as Record<string, unknown>) : data
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), Math.max(0, timeoutMs))
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

const MAX_TOOL_PAGES = 50

export class Psd2LiveMcp {
  private readonly tools = new Map<string, ToolDescriptor>()

  private constructor(private readonly client: Client) {}

  static async connect(url: string, token: string): Promise<Psd2LiveMcp> {
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } }
    })
    return Psd2LiveMcp.connectWithTransport(transport)
  }

  /** Connects over an already-created transport. Used by the offline fake-server tests. */
  static async connectWithTransport(transport: Transport): Promise<Psd2LiveMcp> {
    const client = new Client({ name: 'agent2live-phase0-spike', version: '0.0.0' })
    await client.connect(transport)
    const instance = new Psd2LiveMcp(client)
    await instance.refreshTools()
    return instance
  }

  private async refreshTools(): Promise<void> {
    let cursor: string | undefined
    let pages = 0
    const seenCursors = new Set<string>()
    do {
      if (pages >= MAX_TOOL_PAGES) throw new Error('MCP_TOOL_PAGINATION_LIMIT')
      if (cursor) {
        if (seenCursors.has(cursor)) throw new Error('MCP_TOOL_PAGINATION_LOOP')
        seenCursors.add(cursor)
      }
      const page = await this.client.listTools(cursor ? { cursor } : undefined)
      pages += 1
      for (const tool of page.tools) {
        this.tools.set(tool.name, {
          name: tool.name,
          description: tool.description ?? '',
          inputSchema: tool.inputSchema as JsonSchemaNode
        })
      }
      cursor = page.nextCursor
    } while (cursor)
  }

  descriptors(): ToolDescriptor[] {
    return [...this.tools.values()]
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  async call(name: string, values: Record<string, unknown>): Promise<Record<string, unknown>> {
    const descriptor = this.tools.get(name)
    if (!descriptor) throw new Error(`MCP_TOOL_MISSING:${name}`)
    const request = filterRequest(descriptor.inputSchema, values)
    const result = (await this.client.callTool({
      name,
      arguments: { request }
    })) as unknown as ToolCallResult
    return unwrapData(parseToolPayload(result))
  }

  async waitForJob(jobId: string, timeoutMs = 15 * 60_000): Promise<Record<string, unknown>> {
    const toolName = this.has('job_wait') ? 'job_wait' : this.has('job_get') ? 'job_get' : null
    if (!toolName) throw new Error('MCP_JOB_TOOL_MISSING')
    const schema = this.tools.get(toolName)!.inputSchema
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error('MCP_JOB_TIMEOUT')
      const call = this.call(toolName, buildJobRequest(schema, jobId, Math.min(10_000, remaining)))
      // If the race below times out first, the transport may still reject later.
      // Mark it handled so a hung server cannot surface as an unhandled rejection.
      call.catch(() => {})
      const data = await withTimeout(call, remaining, 'MCP_JOB_TIMEOUT')
      if (isTerminalJob(data)) {
        const status = String(data.status ?? '').toLowerCase()
        if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
          throw new Error(`MCP_JOB_FAILED:${JSON.stringify(data).slice(0, 500)}`)
        }
        return jobResult(data)
      }
      const sleep = deadline - Date.now()
      if (sleep <= 0) throw new Error('MCP_JOB_TIMEOUT')
      await new Promise((resolve) => setTimeout(resolve, Math.min(1_500, sleep)))
    }
  }

  async close(): Promise<void> {
    await this.client.close()
  }
}
