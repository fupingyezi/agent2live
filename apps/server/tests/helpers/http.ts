export async function buildMultipartTestPayload(
  form: FormData
): Promise<{ payload: Buffer; contentType: string }> {
  const request = new Request('http://127.0.0.1/upload', { method: 'POST', body: form })
  const contentType = request.headers.get('content-type')
  if (!contentType) throw new Error('missing multipart content type')
  return { payload: Buffer.from(await request.arrayBuffer()), contentType }
}
