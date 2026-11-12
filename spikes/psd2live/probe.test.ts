import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assessLayerEvidence, finalizeBlockedArtifacts, redactMcpUrl } from './lib/evidence'

describe('blocked evidence markers', () => {
  it('overwrites stale artifacts and creates missing markers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'psd2live-evidence-'))
    writeFileSync(join(dir, 'tools.json'), '{"status":"pass","captured":true}\n')
    writeFileSync(join(dir, 'schemas.json'), '{"status":"pass","captured":true}\n')

    finalizeBlockedArtifacts(
      dir,
      {
        status: 'blocked',
        reason: 'PSD2LIVE_MCP_TOKEN_MISSING',
        finishedAt: '2026-11-12T00:00:00.000Z'
      },
      new Set()
    )

    for (const artifact of ['tools', 'schemas', 'import'] as const) {
      const marker = JSON.parse(readFileSync(join(dir, `${artifact}.json`), 'utf8')) as Record<
        string,
        unknown
      >
      expect(marker).toMatchObject({
        status: 'blocked',
        captured: false,
        reason: 'PSD2LIVE_MCP_TOKEN_MISSING',
        artifact
      })
      expect(marker.note).toContain('No MCP')
      expect(marker.recordedAt).toBe('2026-11-12T00:00:00.000Z')
    }
  })
})

describe('real-PSD layer evidence', () => {
  it('cannot pass a real fixture without layer structure', () => {
    expect(assessLayerEvidence('real', null)).toMatchObject({
      layerCount: null,
      layerEvidence: 'missing',
      failure: 'REAL_PSD_LAYER_EVIDENCE_MISSING'
    })
    expect(assessLayerEvidence('real', undefined)).toMatchObject({
      layerEvidence: 'missing',
      failure: 'REAL_PSD_LAYER_EVIDENCE_MISSING'
    })
  })

  it('keeps the existing low-layer-count failure and leaves synthetic null layers alone', () => {
    expect(assessLayerEvidence('real', []).failure).toBe('IMPORT_LAYER_COUNT_LOW')
    expect(assessLayerEvidence('synthetic', []).failure).toBe('IMPORT_LAYER_COUNT_LOW')
    expect(assessLayerEvidence('synthetic', null)).toMatchObject({
      layerCount: null,
      layerEvidence: 'missing',
      failure: null
    })
    expect(
      assessLayerEvidence(
        'real',
        Array.from({ length: 12 }, (_value, index) => ({ index }))
      )
    ).toMatchObject({ layerCount: 12, layerEvidence: 'present', failure: null })
  })
})

describe('MCP URL redaction', () => {
  it('leaves a plain URL untouched and redacts credentials/query secrets', () => {
    expect(redactMcpUrl('http://127.0.0.1:23871/mcp')).toBe('http://127.0.0.1:23871/mcp')

    const redacted = redactMcpUrl(
      'http://user:pass@127.0.0.1:23871/mcp?token=supersecret&page=2&api_key=abc&authorization=Bearer%20xyz&x=y'
    )
    expect(redacted).toBe(
      'http://127.0.0.1:23871/mcp?token=REDACTED&page=2&api_key=REDACTED&authorization=REDACTED&x=y'
    )
    expect(redacted).not.toMatch(/user|pass|supersecret|abc|xyz/)
  })

  it('redacts token-like query values even when parsing fails', () => {
    const redacted = redactMcpUrl('not a url?token=supersecret&key=abc&page=2')
    expect(redacted).not.toMatch(/supersecret|abc/)
    expect(redacted).toContain('page=2')
  })
})
