import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const BLOCKED_ARTIFACTS = ['tools', 'schemas', 'import'] as const
export type BlockedArtifact = (typeof BLOCKED_ARTIFACTS)[number]
export type FixtureKind = 'synthetic' | 'real'

const SECRET_PARAM = /token|key|auth|secret|password|credential|signature|sig/i

export function redactMcpUrl(raw: string): string {
  try {
    const url = new URL(raw)
    url.username = ''
    url.password = ''
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_PARAM.test(key)) url.searchParams.set(key, 'REDACTED')
    }
    return url.toString()
  } catch {
    // A malformed URL is not valid enough to parse; still strip userinfo and
    // token-like query values rather than persisting them verbatim.
    return raw
      .replace(/\/\/[^/@\s]+@/, '//')
      .replace(
        /([?&][^=&#]*(?:token|key|auth|secret|password|credential|signature|sig)[^=&#]*=)[^&#]*/gi,
        '$1REDACTED'
      )
  }
}

export interface LayerAssessment {
  layerCount: number | null
  layerEvidence: 'present' | 'missing'
  layers: unknown[] | null
  failure: 'REAL_PSD_LAYER_EVIDENCE_MISSING' | 'IMPORT_LAYER_COUNT_LOW' | null
}

export function assessLayerEvidence(kind: FixtureKind, layers: unknown): LayerAssessment {
  if (!Array.isArray(layers)) {
    return {
      layerCount: null,
      layerEvidence: 'missing',
      layers: null,
      failure: kind === 'real' ? 'REAL_PSD_LAYER_EVIDENCE_MISSING' : null
    }
  }
  return {
    layerCount: layers.length,
    layerEvidence: 'present',
    layers,
    failure: layers.length < 10 ? 'IMPORT_LAYER_COUNT_LOW' : null
  }
}

export function writeBlockedMarkers(
  evidenceDir: string,
  reason: string,
  recordedAt = new Date().toISOString(),
  artifacts: readonly BlockedArtifact[] = BLOCKED_ARTIFACTS
): void {
  mkdirSync(evidenceDir, { recursive: true })
  for (const artifact of artifacts) {
    const marker = {
      status: 'blocked',
      captured: false,
      reason,
      artifact,
      note: 'No MCP artifacts were captured; PSD2LIVE_MCP_TOKEN was absent from the probe environment.',
      recordedAt
    }
    writeFileSync(join(evidenceDir, `${artifact}.json`), `${JSON.stringify(marker, null, 2)}\n`)
  }
}

export interface BlockedFinalization {
  status: 'pass' | 'fail' | 'blocked'
  reason: string | null
  finishedAt: string
}

/**
 * Replaces artifacts left over from an earlier successful run with explicit
 * blocked markers. Artifacts captured by the current blocked run are kept.
 */
export function finalizeBlockedArtifacts(
  evidenceDir: string,
  report: BlockedFinalization,
  captured: ReadonlySet<BlockedArtifact>
): void {
  if (report.status !== 'blocked') return
  const missing = BLOCKED_ARTIFACTS.filter((artifact) => !captured.has(artifact))
  if (missing.length === 0) return
  writeBlockedMarkers(evidenceDir, report.reason ?? 'PSD2LIVE_BLOCKED', report.finishedAt, missing)
}
