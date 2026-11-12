import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { writeEvidence } from './evidence.mjs'

const manifestFile = 'docs/sources/phase0-official-sources.json'
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
const required = new Set([
  'codex-app-server',
  'claude-agent-sdk',
  'cubism-web',
  'cubism-license',
  'psd2live',
  'psd2live-mcp',
  'see-through'
])
const sources = []
for (const source of manifest.sources ?? []) {
  let status = null
  let sha256 = null
  let error = null
  let text = ''
  try {
    const response = await fetch(source.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
      headers: { 'user-agent': 'agent2live-phase0-docs-audit' }
    })
    status = response.status
    if (response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer())
      sha256 = createHash('sha256').update(bytes).digest('hex')
      text = bytes.toString('utf8')
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.name : 'FETCH_FAILED'
  }
  sources.push({
    id: source.id,
    url: source.url,
    httpStatus: status,
    sha256,
    retrievedAt: new Date().toISOString(),
    version: source.version ?? null,
    methods: source.methods ?? [],
    license: source.license ?? null,
    redistributable: source.redistributable ?? null,
    methodChecks: (source.methods ?? []).map((method) => ({ method, found: text.includes(method) })),
    error
  })
}
const seen = new Set(sources.map((source) => source.id))
const checks = {
  complete: [...required].every((id) => seen.has(id)),
  http: sources.every((source) => source.httpStatus === 200 && source.sha256?.match(/^[0-9a-f]{64}$/)),
  methods: sources
    .filter((source) =>
      ['codex-app-server', 'claude-agent-sdk', 'cubism-web', 'psd2live-mcp'].includes(source.id)
    )
    .every(
      (source) =>
        Array.isArray(source.methodChecks) &&
        source.methodChecks.length > 0 &&
        source.methodChecks.every((check) => check.found)
    ),
  versions: sources
    .filter((source) =>
      ['codex-app-server', 'claude-agent-sdk', 'psd2live', 'psd2live-mcp'].includes(source.id)
    )
    .every((source) => typeof source.version === 'string' && source.version.length > 0),
  license: sources
    .filter((source) => ['cubism-license', 'psd2live', 'psd2live-mcp', 'see-through'].includes(source.id))
    .every((source) => Boolean(source.license) && source.redistributable !== null)
}
const pass = Object.values(checks).every(Boolean)
const blocked = sources.some((source) => source.error !== null)
writeEvidence('docs/plans/evidence/phase0/G0-DOCS/official-sources.json', {
  gate: 'G0-DOCS',
  status: pass ? 'pass' : blocked ? 'blocked' : 'fail',
  mode: 'real',
  commands: ['node scripts/check-official-sources.mjs'],
  blocker: pass ? null : blocked ? 'OFFICIAL_SOURCE_FETCH_BLOCKED' : 'OFFICIAL_SOURCE_CHECK_FAILED',
  nextAction: pass ? 'run docs gate checks' : 'fix URLs, method records, or license boundaries',
  data: { checks, sources },
  artifactPaths: [manifestFile]
})
if (!pass) process.exitCode = 1
