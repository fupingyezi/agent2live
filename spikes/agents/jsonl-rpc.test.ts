import { PassThrough } from 'node:stream'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { JsonlRpcClient } from './lib/jsonl-rpc'

interface Wire {
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: unknown
}

async function readMessage(stream: PassThrough): Promise<Wire> {
  const reader = createInterface({ input: stream, crlfDelay: Infinity })
  const [line] = await once(reader, 'line')
  reader.close()
  return JSON.parse(String(line)) as Wire
}

function pair(): { client: JsonlRpcClient; toClient: PassThrough; fromClient: PassThrough } {
  const toClient = new PassThrough()
  const fromClient = new PassThrough()
  return { client: new JsonlRpcClient(toClient, fromClient), toClient, fromClient }
}

describe('JsonlRpcClient', () => {
  it('writes requests without a jsonrpc field and resolves matching responses', async () => {
    const { client, toClient, fromClient } = pair()
    const pending = client.request<{ value: string }>('thread/start', { cwd: '/tmp' }, 1000)
    const wire = await readMessage(toClient)
    expect(wire).toMatchObject({ method: 'thread/start', params: { cwd: '/tmp' } })
    expect(wire).not.toHaveProperty('jsonrpc')
    fromClient.write(`${JSON.stringify({ id: wire.id, result: { value: 'ok' } })}\n`)
    await expect(pending).resolves.toEqual({ value: 'ok' })
    client.close()
  })

  it('matches out-of-order responses by numeric id', async () => {
    const { client, toClient, fromClient } = pair()
    const first = client.request<string>('a', {}, 1000)
    const second = client.request<string>('b', {}, 1000)
    const wireA = await readMessage(toClient)
    const wireB = await readMessage(toClient)
    fromClient.write(`${JSON.stringify({ id: wireB.id, result: 'B' })}\n`)
    fromClient.write(`${JSON.stringify({ id: wireA.id, result: 'A' })}\n`)
    await expect(first).resolves.toBe('A')
    await expect(second).resolves.toBe('B')
    client.close()
  })

  it('emits notifications and answers server requests', async () => {
    const { client, toClient, fromClient } = pair()
    const notification = new Promise<unknown>((resolve) => {
      client.once('notification', resolve)
    })
    fromClient.write(`${JSON.stringify({ method: 'turn/started', params: { turn: { id: 't1' } } })}\n`)
    await expect(notification).resolves.toEqual({ method: 'turn/started', params: { turn: { id: 't1' } } })

    const requestSeen = new Promise<{ id: number | string; method: string }>((resolve) => {
      client.once('serverRequest', (request: { id: number | string; method: string }) => {
        client.respond(request.id, { decision: 'accept' })
        resolve(request)
      })
    })
    fromClient.write(
      `${JSON.stringify({
        id: 900,
        method: 'item/commandExecution/requestApproval',
        params: { threadId: 't1', turnId: 'w1', itemId: 'i1', startedAtMs: 1 }
      })}\n`
    )
    const seen = await requestSeen
    expect(seen.method).toBe('item/commandExecution/requestApproval')
    await expect(readMessage(toClient)).resolves.toEqual({ id: 900, result: { decision: 'accept' } })
    client.close()
  })

  it('rejects remote errors and timeouts with stable codes', async () => {
    const { client, toClient, fromClient } = pair()
    const pending = client.request('turn/start', {}, 1000)
    const wire = await readMessage(toClient)
    fromClient.write(`${JSON.stringify({ id: wire.id, error: { code: -32000, message: 'details' } })}\n`)
    await expect(pending).rejects.toThrow('RPC_REMOTE_ERROR')

    await expect(client.request('thread/start', {}, 10)).rejects.toThrow('RPC_TIMEOUT')
    client.close()
  })

  it('rejects pending requests on close and survives malformed lines', async () => {
    const { client, toClient, fromClient } = pair()
    const malformed = new Promise<Error>((resolve) => {
      client.once('protocolError', resolve)
    })
    fromClient.write('not-json\n')
    await expect(malformed).resolves.toBeInstanceOf(Error)

    const pending = client.request('slow', {}, 1000)
    await readMessage(toClient)
    client.close()
    await expect(pending).rejects.toThrow('RPC_CLOSED')
  })
})
