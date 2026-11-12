import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { qcModelDirectory } from '@agent2live/live2d-runtime/qc'
import {
  assessLayerEvidence,
  finalizeBlockedArtifacts,
  redactMcpUrl,
  type BlockedArtifact
} from './lib/evidence'
import { Psd2LiveMcp, pickCubismTarget } from './lib/mcp'

const EVIDENCE = resolve('docs/plans/evidence/phase0/G0-PSD2LIVE')
const WORK = resolve('spikes/psd2live/work')
const fixture = resolve(process.env.PSD2LIVE_FIXTURE ?? join(WORK, 'fixture.psd'))
const mcpUrl = process.env.PSD2LIVE_MCP_URL ?? 'http://127.0.0.1:23871/mcp'
const evidenceFile = join(EVIDENCE, 'result.json')
const timestamp = Date.now()
const capturedArtifacts = new Set<BlockedArtifact>()

class Blocked extends Error {
  constructor(readonly reason: string) {
    super(reason)
  }
}

interface ExportEvidence {
  tool: string
  target: string | null
  outputDirectory: string
  jobId: string | null
  model3: string | null
  url: string | null
  sha256: string | null
  qc: unknown
  status: 'pass' | 'fail' | 'skipped'
  reason: string | null
}

interface ProbeEvidence {
  gate: 'G0-PSD2LIVE'
  status: 'pass' | 'fail' | 'blocked'
  decomposition: 'pass' | 'fail' | 'blocked' | 'pending'
  render: 'pending'
  reason: string | null
  warnings: string[]
  fixture: { kind: 'synthetic' | 'real'; sha256: string; layerCountHint: number | null } | null
  mcp: {
    url: string
    toolCount: number
    hasImport: boolean
    hasExportTarget: boolean
    hasJobWait: boolean
  }
  psd2liveCommit: string | null
  import: {
    fixture: string
    jobId: string | null
    projectId: string | null
    stateType: string | null
    layerCount: number | null
    layerEvidence: 'present' | 'missing'
    layers: unknown
  } | null
  exports: Record<string, ExportEvidence>
  startedAt: string
  finishedAt: string
}

function write(report: ProbeEvidence): void {
  mkdirSync(EVIDENCE, { recursive: true })
  writeFileSync(evidenceFile, `${JSON.stringify(report, null, 2)}\n`)
}

function writeEvidence(report: ProbeEvidence): void {
  write(report)
  finalizeBlockedArtifacts(EVIDENCE, report, capturedArtifacts)
}

function capture(artifact: BlockedArtifact): void {
  capturedArtifacts.add(artifact)
}

function redact(value: string): string {
  const token = process.env.PSD2LIVE_MCP_TOKEN
  return token ? value.split(token).join('[REDACTED]') : value
}

function findModel3(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.model3.json')) found.push(full)
    }
  }
  if (existsSync(root)) walk(root)
  return found
}

function modelUrl(model3: string): string {
  return `agent2live-model://models/${relative(WORK, model3).split(sep).join('/')}`
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function parseJsonEnv(name: string): Record<string, unknown> | undefined {
  const value = process.env[name]
  if (!value) return undefined
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    throw new Error(`${name}_INVALID_JSON`)
  }
}

function commitOf(dir: string): string | null {
  try {
    const head = readFileSync(join(dir, '.git', 'HEAD'), 'utf8').trim()
    if (!head.startsWith('ref: ')) return head
    return readFileSync(join(dir, '.git', head.slice(5)), 'utf8').trim()
  } catch {
    return null
  }
}

async function exportOnce(
  mcp: Psd2LiveMcp,
  projectId: string,
  state: unknown,
  version: '4.2' | '5.0'
): Promise<ExportEvidence> {
  const outputDirectory = join(WORK, `export-${version === '4.2' ? '42' : '50'}-${timestamp}`)
  mkdirSync(outputDirectory, { recursive: true })
  const attempt: ExportEvidence = {
    tool: 'project_export_target',
    target: null,
    outputDirectory,
    jobId: null,
    model3: null,
    url: null,
    sha256: null,
    qc: null,
    status: 'fail',
    reason: null
  }

  try {
    const targetTool = 'project_export_target'
    const schema = mcp.descriptors().find((tool) => tool.name === targetTool)!.inputSchema
    const target =
      process.env[version === '4.2' ? 'PSD2LIVE_TARGET_42' : 'PSD2LIVE_TARGET_50'] ??
      pickCubismTarget(schema, version)
    const settings = parseJsonEnv(version === '4.2' ? 'PSD2LIVE_SETTINGS_42' : 'PSD2LIVE_SETTINGS_50')
    if (!target) {
      attempt.reason = 'TARGET_NOT_DISCOVERED'
      return attempt
    }
    attempt.target = target

    const started = await mcp.call(targetTool, {
      request_id: `export-${version}-${randomUUID()}`,
      project_id: projectId,
      state,
      target,
      output_directory: outputDirectory,
      ...(settings ? { settings } : {})
    })
    const jobId = typeof started.id === 'string' ? started.id : null
    attempt.jobId = jobId
    if (!jobId) {
      attempt.reason = 'EXPORT_JOB_ID_MISSING'
      return attempt
    }

    const result = await mcp.waitForJob(jobId)
    const models = findModel3(outputDirectory)
    if (models.length !== 1) {
      attempt.reason = models.length === 0 ? 'MODEL3_NOT_FOUND' : 'MODEL3_AMBIGUOUS'
      attempt.qc = result
      return attempt
    }
    const model3 = models[0]!
    const qc = await qcModelDirectory(dirname(model3), basename(model3))
    attempt.model3 = model3
    attempt.url = modelUrl(model3)
    attempt.sha256 = sha256(model3)
    attempt.qc = qc
    attempt.status = qc.pass ? 'pass' : 'fail'
    attempt.reason = qc.pass ? null : `QC_BLOCKERS_${qc.blockers.join(',')}`
    return attempt
  } catch (error) {
    attempt.status = 'fail'
    attempt.reason = redact(error instanceof Error ? error.message : String(error)).slice(0, 500)
    return attempt
  }
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString()
  let mcp: Psd2LiveMcp | null = null
  const report: ProbeEvidence = {
    gate: 'G0-PSD2LIVE',
    status: 'blocked',
    decomposition: 'blocked',
    render: 'pending',
    reason: null,
    warnings: [],
    fixture: null,
    mcp: {
      url: redactMcpUrl(mcpUrl),
      toolCount: 0,
      hasImport: false,
      hasExportTarget: false,
      hasJobWait: false
    },
    psd2liveCommit: process.env.PSD2LIVE_DIR ? commitOf(process.env.PSD2LIVE_DIR) : null,
    import: null,
    exports: {},
    startedAt,
    finishedAt: startedAt
  }

  try {
    if (!existsSync(fixture)) throw new Error('FIXTURE_MISSING')
    report.fixture = {
      kind: process.env.PSD2LIVE_FIXTURE_KIND === 'real' ? 'real' : 'synthetic',
      sha256: sha256(fixture),
      layerCountHint: null
    }
    const token = process.env.PSD2LIVE_MCP_TOKEN
    if (!token) throw new Blocked('PSD2LIVE_MCP_TOKEN_MISSING')

    try {
      mcp = await Psd2LiveMcp.connect(mcpUrl, token)
    } catch (error) {
      throw new Blocked(
        `PSD2LIVE_MCP_UNREACHABLE:${redact(error instanceof Error ? error.message : String(error))}`
      )
    }

    const descriptors = mcp.descriptors()
    report.mcp.toolCount = descriptors.length
    report.mcp.hasImport = mcp.has('project_import_psd')
    report.mcp.hasExportTarget = mcp.has('project_export_target')
    report.mcp.hasJobWait = mcp.has('job_wait') || mcp.has('job_get')
    mkdirSync(EVIDENCE, { recursive: true })
    writeFileSync(
      join(EVIDENCE, 'tools.json'),
      `${JSON.stringify(
        descriptors.map(({ name, description }) => ({ name, description })),
        null,
        2
      )}\n`
    )
    writeFileSync(join(EVIDENCE, 'schemas.json'), `${JSON.stringify(descriptors, null, 2)}\n`)
    capture('tools')
    capture('schemas')

    if (!report.mcp.hasImport) throw new Error('MCP_IMPORT_TOOL_MISSING')
    if (!report.mcp.hasExportTarget) throw new Error('MCP_EXPORT_TARGET_MISSING')

    const imported = await mcp.call('project_import_psd', {
      request_id: `import-${randomUUID()}`,
      path: fixture,
      discard_unsaved: true,
      modifiers: 'recommended'
    })
    const jobId = typeof imported.id === 'string' ? imported.id : null
    const importedResult = jobId ? await mcp.waitForJob(jobId) : imported
    writeFileSync(join(EVIDENCE, 'import.json'), `${JSON.stringify({ imported, importedResult }, null, 2)}\n`)
    capture('import')

    const projectId =
      typeof importedResult.project_id === 'string'
        ? importedResult.project_id
        : typeof imported.project_id === 'string'
          ? imported.project_id
          : null
    const state = importedResult.state ?? imported.state
    if (!projectId || state === undefined) throw new Error('IMPORT_PROJECT_STATE_MISSING')
    const assessment = assessLayerEvidence(report.fixture?.kind ?? 'synthetic', importedResult.layers)
    report.import = {
      fixture,
      jobId,
      projectId,
      stateType: typeof state,
      layerCount: assessment.layerCount,
      layerEvidence: assessment.layerEvidence,
      layers: assessment.layers
    }
    if (assessment.failure === 'REAL_PSD_LAYER_EVIDENCE_MISSING') {
      // A real fixture without layer structure cannot prove decomposition. Do
      // not let a successful export hide the missing evidence.
      report.warnings.push(assessment.failure)
      report.status = 'fail'
      report.decomposition = 'fail'
      report.reason = assessment.failure
      process.exitCode = 1
      return
    }
    if (assessment.failure) {
      throw new Error(`${assessment.failure}:${assessment.layerCount ?? 'unknown'}`)
    }

    const export42 = await exportOnce(mcp, projectId, state, '4.2')
    report.exports['4.2'] = export42
    report.exports['5.0'] = await exportOnce(mcp, projectId, state, '5.0')

    if (export42.status !== 'pass') {
      report.status = 'fail'
      report.decomposition = 'fail'
      report.reason = export42.reason ?? 'EXPORT_4_2_FAILED'
      process.exitCode = 1
      return
    }
    if (report.fixture?.kind !== 'real') {
      // A synthetic fixture can validate the pipeline contract, but the gate needs a
      // privacy-safe real layered PSD before auto-binding may be claimed.
      report.status = 'blocked'
      report.decomposition = 'blocked'
      report.reason = 'REAL_PSD_FIXTURE_MISSING'
      process.exitCode = 2
      return
    }
    report.status = 'pass'
    report.decomposition = 'pass'
    report.reason = null
    process.exitCode = 0
  } catch (error) {
    if (error instanceof Blocked) {
      report.status = 'blocked'
      report.decomposition = 'blocked'
      report.reason = error.reason
      process.exitCode = 2
    } else {
      report.status = 'fail'
      report.decomposition = 'fail'
      report.reason = redact(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  } finally {
    await mcp?.close()
    report.finishedAt = new Date().toISOString()
    writeEvidence(report)
    console.log(
      JSON.stringify(
        { status: report.status, decomposition: report.decomposition, reason: report.reason },
        null,
        2
      )
    )
  }
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : 'PSD2LIVE_PROBE_FAILED'))
  process.exitCode = 1
})
