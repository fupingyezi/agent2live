import sharp from 'sharp'

export async function png(width = 640, height = 960, color = { r: 210, g: 180, b: 150 }): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { ...color, alpha: 1 } } })
    .png()
    .toBuffer()
}

export async function jpeg(width = 640, height = 960): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 100, g: 120, b: 140 } } })
    .jpeg()
    .toBuffer()
}

export function imageForm(
  metadata: unknown,
  files: Array<{ name: string; bytes: Buffer; type?: string }>
): FormData {
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  for (const file of files) {
    const bytes = new Uint8Array(file.bytes.length)
    bytes.set(file.bytes)
    form.append(file.name, new Blob([bytes], { type: file.type ?? 'image/png' }), `${file.name}.png`)
  }
  return form
}
