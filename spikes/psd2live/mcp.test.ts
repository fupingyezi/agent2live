import { afterEach, describe, expect, it } from 'vitest'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool
} from '@modelcontextprotocol/sdk/types.js'
import {
  Psd2LiveMcp,
  buildJobRequest,
  filterRequest,
  parseToolPayload,
  pickCubismTarget,
  unwrapData,
  type JsonSchemaNode
} from './lib/mcp'

const schema: JsonSchemaNode = {
  type: 'object',
  properties: {
    request: {
      type: 'object',
      properties: {
        request_id: { type: 'string' },
        project_id: { type: 'string' },
        state: { type: 'string' },
        job_id: { type: 'string' },
        wait_ms: { type: 'integer' },
        path: { type: 'string' },
        discard_unsaved: { type: 'boolean' },
        target: { type: 'string', enum: ['cubism4.2', 'cubism5.0', 'vtube_studio'] },
        output_directory: { type: 'string' }
      }
    }
  }
}

const PROJECT_IMPORT_SCHEMA: JsonSchemaNode = {
  type: 'object',
  properties: {
    request: {
      type: 'object',
      properties: {
        request_id: { type: 'string' },
        path: { type: 'string' },
        discard_unsaved: { type: 'boolean' }
      }
    }
  }
}

const JOB_SCHEMA: JsonSchemaNode = {
  type: 'object',
  properties: {
    request: {
      type: 'object',
      properties: {
        job_id: { type: 'string' },
        wait_ms: { type: 'integer' }
      }
    }
  }
}

interface FakeServer {
  mcp: Psd2LiveMcp
  calls: Array<{ name: string; request: Record<string, unknown> }>
  close(): Promise<void>
}

async function startFakeServer(
  tools: Tool[],
  handler: (name: string, request: Record<string, unknown>) => CallToolResult | Promise<CallToolResult>
): Promise<FakeServer> {
  const server = new Server({ name: 'fake-psd2live', version: '0.0.0' }, { capabilities: { tools: {} } })
  const calls: Array<{ name: string; request: Record<string, unknown> }> = []
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name
    const args = (request.params.arguments ?? {}) as Record<string, unknown>
    const payload = (args.request ?? {}) as Record<string, unknown>
    calls.push({ name, request: payload })
    return handler(name, payload)
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const mcp = await Psd2LiveMcp.connectWithTransport(clientTransport)
  return {
    mcp,
    calls,
    async close() {
      await mcp.close()
      await server.close()
    }
  }
}

function tool(name: string, inputSchema: JsonSchemaNode): Tool {
  return { name, description: `${name} fake`, inputSchema } as Tool
}

describe('PSD2Live MCP helpers', () => {
  it('parses text and structured tool payloads', () => {
    expect(
      parseToolPayload({ content: [{ type: 'text', text: '{"ok":true,"data":{"id":"job-1"}}' }] })
    ).toEqual({ ok: true, data: { id: 'job-1' } })
    expect(parseToolPayload({ structuredContent: { ok: true, data: { id: 'job-2' } } })).toEqual({
      ok: true,
      data: { id: 'job-2' }
    })
    expect(() => parseToolPayload({ isError: true, content: [{ type: 'text', text: 'boom' }] })).toThrow(
      'MCP_TOOL_ERROR:boom'
    )
  })

  it('unwraps data and surfaces rejection', () => {
    expect(unwrapData({ ok: true, operation: 'x', data: { id: 'job-1' } })).toEqual({ id: 'job-1' })
    expect(() => unwrapData({ ok: false, error: { code: 'bad_request', message: 'nope' } })).toThrow(
      'MCP_REJECTED:bad_request:nope'
    )
  })

  it('builds a schema-shaped job request', () => {
    expect(buildJobRequest(schema, 'job-9', 2500)).toEqual({
      job_id: 'job-9',
      wait_ms: 2500
    })
  })

  it('drops fields the installed version does not declare', () => {
    expect(
      filterRequest(schema, {
        request_id: 'req-1',
        path: '/tmp/x.psd',
        discard_unsaved: true,
        modifiers: 'recommended'
      })
    ).toEqual({
      request_id: 'req-1',
      path: '/tmp/x.psd',
      discard_unsaved: true
    })
  })

  it('selects Cubism export targets from the live schema', () => {
    expect(pickCubismTarget(schema, '4.2')).toBe('cubism4.2')
    expect(pickCubismTarget(schema, '5.0')).toBe('cubism5.0')
    expect(pickCubismTarget(schema, '4.2')).not.toBe('vtube_studio')
  })
})

describe('PSD2Live MCP client over an offline transport', () => {
  let fake: FakeServer | null = null

  afterEach(async () => {
    await fake?.close()
    fake = null
  })

  it('lists tools and filters call arguments to the declared schema', async () => {
    fake = await startFakeServer([tool('project_import_psd', PROJECT_IMPORT_SCHEMA)], (_name, request) => ({
      content: [{ type: 'text', text: JSON.stringify({ ok: true, data: { id: 'job-1', request } }) }]
    }))

    expect(fake.mcp.descriptors().map((descriptor) => descriptor.name)).toEqual(['project_import_psd'])
    expect(fake.mcp.has('project_import_psd')).toBe(true)
    expect(fake.mcp.has('project_export_target')).toBe(false)

    const data = await fake.mcp.call('project_import_psd', {
      request_id: 'req-1',
      path: '/tmp/model.psd',
      discard_unsaved: true,
      modifiers: 'recommended'
    })
    expect(data).toEqual({
      id: 'job-1',
      request: { request_id: 'req-1', path: '/tmp/model.psd', discard_unsaved: true }
    })
    expect(fake.calls).toEqual([
      {
        name: 'project_import_psd',
        request: { request_id: 'req-1', path: '/tmp/model.psd', discard_unsaved: true }
      }
    ])
  })

  it('polls the discovered job tool until the job is terminal', async () => {
    let polls = 0
    fake = await startFakeServer([tool('job_get', JOB_SCHEMA)], (_name, request) => {
      polls += 1
      const running = { ok: true, data: { job_id: request.job_id, status: 'running' } }
      const done = {
        ok: true,
        data: { job_id: request.job_id, status: 'succeeded', result: { project_id: 'project-1' } }
      }
      return { content: [{ type: 'text', text: JSON.stringify(polls === 1 ? running : done) }] }
    })

    const result = await fake.mcp.waitForJob('job-9', 10_000)
    expect(result).toEqual({ project_id: 'project-1' })
    expect(polls).toBe(2)
    expect(fake.calls[0]!.request).toEqual({ job_id: 'job-9', wait_ms: 10_000 })
  })

  it('surfaces tool errors and rejection payloads', async () => {
    fake = await startFakeServer([tool('project_import_psd', PROJECT_IMPORT_SCHEMA)], (name) => {
      if (name === 'project_import_psd') {
        return { isError: true, content: [{ type: 'text', text: 'boom' }] }
      }
      return {
        content: [
          { type: 'text', text: JSON.stringify({ ok: false, error: { code: 'bad', message: 'no' } }) }
        ]
      }
    })

    await expect(fake.mcp.call('project_import_psd', { request_id: 'r', path: '/x.psd' })).rejects.toThrow(
      'MCP_TOOL_ERROR:boom'
    )
    await expect(fake.mcp.call('missing_tool', { request_id: 'r' })).rejects.toThrow(
      'MCP_TOOL_MISSING:missing_tool'
    )
  })

  it('rejects job tools that the server does not expose', async () => {
    fake = await startFakeServer([tool('project_import_psd', PROJECT_IMPORT_SCHEMA)], () => ({
      content: [{ type: 'text', text: '{"ok":true,"data":{}}' }]
    }))
    await expect(fake.mcp.waitForJob('job-1', 100)).rejects.toThrow('MCP_JOB_TOOL_MISSING')
  })

  it('bounds a hung job call by the requested timeout', async () => {
    fake = await startFakeServer([tool('job_get', JOB_SCHEMA)], () => new Promise<CallToolResult>(() => {}))

    const started = Date.now()
    await expect(fake.mcp.waitForJob('job-hung', 200)).rejects.toThrow('MCP_JOB_TIMEOUT')
    expect(Date.now() - started).toBeLessThan(2_000)
  }, 3_000)
})

describe('PSD2Live MCP pagination guards', () => {
  it('rejects a server that repeats the same listTools cursor', async () => {
    const server = new Server(
      { name: 'fake-paginated-psd2live', version: '0.0.0' },
      { capabilities: { tools: {} } }
    )
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [tool('project_import_psd', PROJECT_IMPORT_SCHEMA)],
      nextCursor: 'same-cursor'
    }))
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)

    try {
      await expect(Psd2LiveMcp.connectWithTransport(clientTransport)).rejects.toThrow(
        'MCP_TOOL_PAGINATION_LOOP'
      )
    } finally {
      await server.close()
    }
  }, 3_000)
})
