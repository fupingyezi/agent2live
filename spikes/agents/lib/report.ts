import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type ProbeStatus = 'pass' | 'fail' | 'blocked'

export interface AgentProbeChecks {
  launch: boolean
  turn: boolean
  resume: boolean
  interrupt: boolean
  approval: boolean
  streaming: boolean
}

export interface AgentProbeReport {
  schemaVersion: 'agent-probe/1'
  provider: 'codex' | 'claude'
  status: ProbeStatus
  blocker: string | null
  startedAt: string
  finishedAt: string
  durationMs: number
  checks: AgentProbeChecks
  metrics: {
    approvalCount: number
    allowedApprovalCount: number
    notificationTypes: string[]
    sessionRef: string | null
    threadRef: string | null
    resultSubtype: string | null
    tokenMatched: boolean | null
    interruptResolved: boolean
  }
  env: {
    providerVersion: string
    node: string
    platform: string
    authSource: string | null
  }
}

export function shortHash(value: string | null | undefined): string | null {
  if (!value) return null
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

export function authSource(env: NodeJS.ProcessEnv): 'api_key' | 'oauth_token' | null {
  if (env.ANTHROPIC_API_KEY?.trim()) return 'api_key'
  if (env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) return 'oauth_token'
  return null
}

export function safeErrorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(code)) return code
    const name = (error as { name?: unknown }).name
    if (typeof name === 'string' && /^[A-Za-z]+$/.test(name)) return name
  }
  return 'UNKNOWN'
}

export function statusFromChecks(checks: AgentProbeChecks): ProbeStatus {
  return Object.values(checks).every(Boolean) ? 'pass' : 'fail'
}

export function writeProbeReport(provider: 'codex' | 'claude', report: AgentProbeReport): string {
  const dir = resolve('docs/plans/evidence/phase0/G0-AGENT')
  mkdirSync(dir, { recursive: true })
  const file = resolve(dir, `${provider}.json`)
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
  return file
}
