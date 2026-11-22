import { afterEach, describe, expect, it } from 'vitest'
import { assertSafeImageUrl, fetchImageBytes } from '../src/http'
import { startTestServer, type TestServer } from './helpers'

let server: TestServer | null = null
afterEach(async () => {
  await server?.close()
  server = null
})

function expectUnsafe(url: string): void {
  expect(() => assertSafeImageUrl(url)).toThrow(
    expect.objectContaining({ code: 'PROVIDER_INVALID_RESPONSE' })
  )
}

describe('provider image URL safety', () => {
  it('rejects file, metadata, private and userinfo URLs', () => {
    for (const url of [
      'file:///etc/passwd',
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.5/image.png',
      'http://192.168.1.10/image.png',
      'https://user:pass@example.com/image.png'
    ]) {
      expectUnsafe(url)
    }
  })

  it('rejects unspecified, IPv6 unspecified and CGNAT hosts', () => {
    for (const url of [
      'http://0.0.0.0/image.png',
      'https://0.0.0.0/image.png',
      'http://[::]/image.png',
      'https://[::]/image.png',
      'https://100.64.0.0/image.png',
      'https://100.64.0.1/image.png',
      'https://100.127.255.255/image.png'
    ]) {
      expectUnsafe(url)
    }
    for (const url of ['https://100.63.255.255/image.png', 'https://100.128.0.0/image.png']) {
      expect(() => assertSafeImageUrl(url)).not.toThrow()
    }
  })

  it('rejects IPv4-mapped IPv6 private and loopback addresses', () => {
    for (const url of [
      'https://[::ffff:10.0.0.1]/image.png',
      'https://[::ffff:192.168.1.10]/image.png',
      'https://[::ffff:169.254.169.254]/image.png',
      'https://[::ffff:127.0.0.1]/image.png',
      'https://[::127.0.0.1]/image.png'
    ]) {
      expectUnsafe(url)
    }
  })

  it('only allows the exact loopback hosts', () => {
    for (const url of [
      'http://127.0.0.2/image.png',
      'https://127.0.0.2/image.png',
      'https://[::ffff:127.0.0.1]/image.png'
    ]) {
      expectUnsafe(url)
    }
    for (const url of [
      'http://127.0.0.1:1234/image.png',
      'http://localhost:1234/image.png',
      'http://[::1]:1234/image.png'
    ]) {
      expect(() => assertSafeImageUrl(url)).not.toThrow()
    }
  })

  it('rejects metadata and localhost aliases that bypass literal checks', () => {
    for (const url of ['https://metadata.google.internal./image.png', 'https://foo.localhost/image.png']) {
      expectUnsafe(url)
    }
  })

  it('allows https CDNs and loopback HTTP for local adapters', async () => {
    expect(() => assertSafeImageUrl('https://cdn.example.com/image.png')).not.toThrow()
    expect(() => assertSafeImageUrl('http://127.0.0.1:1234/image.png')).not.toThrow()

    server = await startTestServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'image/png' })
      response.end(Buffer.from([1, 2, 3]))
    })
    const result = await fetchImageBytes(
      `${server.url}/image.png`,
      { requestId: 'req-safe-image' },
      { maxBytes: 1024 }
    )
    expect(result.bytes).toEqual(Buffer.from([1, 2, 3]))
  })

  it('rejects unsafe URLs before fetching', async () => {
    let requests = 0
    server = await startTestServer((_request, response) => {
      requests += 1
      response.writeHead(200, { 'content-type': 'image/png' })
      response.end(Buffer.from([1]))
    })

    await expect(
      fetchImageBytes(
        'http://169.254.169.254/latest/meta-data',
        { requestId: 'req-unsafe-image' },
        { maxBytes: 1024 }
      )
    ).rejects.toMatchObject({ code: 'PROVIDER_INVALID_RESPONSE' })
    expect(requests).toBe(0)
  })
})
