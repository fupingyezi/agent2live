import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { readPsd } from 'ag-psd'
import { SeeThroughClient } from './client'

const evidenceDir = resolve('docs/plans/evidence/phase0/G0-SEETHROUGH')
mkdirSync(evidenceDir, { recursive: true })
const evidenceFile = resolve(evidenceDir, 'real-worker.json')
const decomposedPsdFile = join(evidenceDir, 'decomposition.psd')

// Never print or persist the worker URL or token; they are operator secrets.
function redact(value: string): string {
  let result = value
  for (const secret of [process.env.SEE_THROUGH_WORKER_URL, process.env.SEE_THROUGH_WORKER_TOKEN]) {
    if (secret) result = result.split(secret).join('[REDACTED]')
  }
  return result
}

async function main(): Promise<void> {
  const url = process.env.SEE_THROUGH_WORKER_URL
  const token = process.env.SEE_THROUGH_WORKER_TOKEN
  const input = process.env.SEE_THROUGH_INPUT_IMAGE
  const startedAt = new Date().toISOString()
  if (!url || !token || !input) {
    const blocked = {
      kind: 'see-through-real-worker',
      status: 'blocked',
      reason: 'SEE_THROUGH_WORKER_ENV_MISSING',
      note: 'No NVIDIA worker configured. Auto-decomposition remains an unproven claim.',
      startedAt,
      finishedAt: new Date().toISOString()
    }
    writeFileSync(evidenceFile, `${JSON.stringify(blocked, null, 2)}\n`)
    console.log(JSON.stringify(blocked, null, 2))
    process.exitCode = 2
    return
  }
  if (!existsSync(input)) throw new Error('SEE_THROUGH_INPUT_IMAGE_NOT_FOUND')

  const client = new SeeThroughClient(url, token)
  const health = await client.health()
  const image = readFileSync(input)
  const started = Date.now()
  const job = await client.submit(image, `real-${randomUUID()}`)
  const finished = await client.waitForJob(job.id, 15 * 60_000)
  const psd = await client.downloadResult(finished)
  const parsed = readPsd(psd, {
    useImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true
  })
  const psdSha256 = createHash('sha256').update(psd).digest('hex')
  if (finished.result?.psd.sha256 && finished.result.psd.sha256 !== psdSha256) {
    throw new Error('SEE_THROUGH_CHECKSUM_MISMATCH')
  }
  writeFileSync(decomposedPsdFile, psd)
  const metrics = finished.result?.metrics
  const structuralPass = finished.status === 'succeeded' && (parsed.children?.length ?? 0) > 0
  const qualityPass = Boolean(
    metrics &&
      metrics.missingRequiredRoles.length === 0 &&
      metrics.composite.alphaIou >= 0.995 &&
      metrics.composite.deltaE2000P95 <= 3 &&
      metrics.manualInterventionCount === 0
  )
  const report = {
    kind: 'see-through-real-worker',
    status: structuralPass && qualityPass ? 'pass' : 'fail',
    scope: 'structure-and-quality',
    structuralStatus: structuralPass ? 'pass' : 'fail',
    qualityStatus: qualityPass ? 'pass' : 'fail',
    psd2liveAcceptance: 'unverified',
    elapsedMs: Date.now() - started,
    metrics: metrics ?? null,
    worker: {
      workerVersion: health.workerVersion,
      gpu: health.gpu,
      model: health.models.seeThrough
    },
    psd: {
      file: decomposedPsdFile,
      bytes: psd.length,
      sha256: psdSha256,
      workerSha256: finished.result?.psd.sha256 ?? null,
      layerCount: parsed.children?.length ?? 0,
      layers: finished.result?.layers ?? []
    },
    startedAt,
    finishedAt: new Date().toISOString()
  }
  writeFileSync(evidenceFile, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = report.status === 'pass' ? 0 : 1
}

main().catch((error) => {
  const report = {
    kind: 'see-through-real-worker',
    status: 'fail',
    reason: redact(error instanceof Error ? error.message : String(error)),
    psd2liveAcceptance: 'unverified',
    finishedAt: new Date().toISOString()
  }
  writeFileSync(evidenceFile, `${JSON.stringify(report, null, 2)}\n`)
  console.error(JSON.stringify(report, null, 2))
  process.exitCode = 1
})
