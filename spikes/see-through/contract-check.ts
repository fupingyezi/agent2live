import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readPsd } from 'ag-psd'
import sharp from 'sharp'
import { SeeThroughClient } from './client'
import { startStubWorker } from './stub-worker'

async function main(): Promise<void> {
  const evidenceDir = resolve('docs/plans/evidence/phase0/G0-SEETHROUGH')
  mkdirSync(evidenceDir, { recursive: true })
  const worker = await startStubWorker({ token: 'stub-contract-token' })
  try {
    const client = new SeeThroughClient(worker.url, 'stub-contract-token')
    const image = await sharp({
      create: { width: 512, height: 640, channels: 3, background: { r: 240, g: 220, b: 200 } }
    })
      .png()
      .toBuffer()
    const started = Date.now()
    const job = await client.submit(image, `stub-${randomUUID()}`)
    const finished = await client.waitForJob(job.id, 30_000)
    const psd = await client.downloadResult(finished)
    const parsed = readPsd(psd, {
      useImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true
    })
    const report = {
      kind: 'see-through-contract',
      worker: 'stub',
      status: finished.status === 'succeeded' && parsed.children?.length === 20 ? 'pass' : 'fail',
      semanticQuality: 'not-evaluated',
      psd2liveAcceptance: 'not-tested',
      elapsedMs: Date.now() - started,
      psdBytes: psd.length,
      layerCount: parsed.children?.length ?? 0,
      layers: finished.result?.layers.map((layer) => layer.name) ?? [],
      note: 'Stub result is structural only. Never use it as decomposition quality evidence.'
    }
    writeFileSync(resolve(evidenceDir, 'stub-contract.json'), `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify(report, null, 2))
    process.exitCode = report.status === 'pass' ? 0 : 1
  } finally {
    await worker.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
