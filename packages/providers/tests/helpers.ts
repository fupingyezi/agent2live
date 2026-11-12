import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

export interface TestRequest {
  method: string
  url: string
  headers: IncomingMessage['headers']
  body: Buffer
}

export interface TestServer {
  url: string
  requests: TestRequest[]
  close(): Promise<void>
}

export async function startTestServer(
  handler: (request: TestRequest, response: ServerResponse) => void | Promise<void>
): Promise<TestServer> {
  const requests: TestRequest[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const testRequest: TestRequest = {
      method: request.method ?? 'GET',
      url: request.url ?? '/',
      headers: request.headers,
      body: Buffer.concat(chunks)
    }
    requests.push(testRequest)
    try {
      await handler(testRequest, response)
    } catch {
      response.writeHead(500).end()
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('TEST_SERVER_BIND_FAILED')
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      })
    }
  }
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}
