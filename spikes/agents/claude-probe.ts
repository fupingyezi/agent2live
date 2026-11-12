import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { query, type CanUseTool, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  authSource,
  shortHash,
  statusFromChecks,
  writeProbeReport,
  type AgentProbeChecks,
  type AgentProbeReport
} from './lib/report'
import { isAllowedProbeCommand } from './lib/approval'

const PROMPT_APPROVAL =
  'Use Bash to run exactly this command in the working directory: printf agent2live-claude-probe. Do not use any other tool. Then reply with exactly: CLAUDE_OK.'
const PROMPT_RESUME = 'Reply with exactly: RESUME_OK.'
const PROMPT_INTERRUPT =
  'Use Bash to run exactly this command in the working directory: sleep 30. Wait for it, then reply with exactly: DONE.'

interface TextQueryResult {
  sessionId: string
  subtype: string
  text: string
  initSeen: boolean
}

function packageVersion(name: string): string {
  try {
    const manifest = resolve('node_modules', name, 'package.json')
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string }
    return parsed.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function permissionRecorder(record: { count: number; allowed: number }): CanUseTool {
  const allowedCommands = new Set(['printf agent2live-claude-probe', 'sleep 30'])
  return async (toolName, input) => {
    record.count += 1
    const command = typeof input.command === 'string' ? input.command : ''
    if (toolName === 'Bash' && isAllowedProbeCommand(command, allowedCommands)) {
      record.allowed += 1
      return { behavior: 'allow', updatedInput: input }
    }
    return { behavior: 'deny', message: 'Phase 0 probe only permits the exact harmless command.' }
  }
}

async function runTextQuery(
  prompt: string,
  options: {
    cwd: string
    configDir: string
    canUseTool?: CanUseTool
    resume?: string
    controller: AbortController
  }
): Promise<TextQueryResult> {
  let sessionId = ''
  let subtype = 'unknown'
  let text = ''
  let initSeen = false
  const timeout = setTimeout(() => options.controller.abort(), 180_000)
  try {
    for await (const message of query({
      prompt,
      options: {
        cwd: options.cwd,
        model: process.env.CLAUDE_PROBE_MODEL ?? 'claude-sonnet-5',
        maxTurns: 4,
        permissionMode: 'default',
        settingSources: [],
        includePartialMessages: true,
        env: {
          ...process.env,
          CLAUDE_CONFIG_DIR: options.configDir,
          CLAUDE_AGENT_SDK_CLIENT_APP: 'agent2live-phase0-probe'
        },
        abortController: options.controller,
        ...(options.resume ? { resume: options.resume } : {}),
        ...(options.canUseTool ? { canUseTool: options.canUseTool } : {})
      }
    })) {
      if (message.type === 'system' && message.subtype === 'init') initSeen = true
      if (message.type === 'result') {
        sessionId = message.session_id
        subtype = message.subtype
        if (message.subtype === 'success') text = message.result
      }
    }
  } finally {
    clearTimeout(timeout)
  }
  return { sessionId, subtype, text, initSeen }
}

async function runInterruptQuery(
  cwd: string,
  configDir: string,
  record: { count: number; allowed: number }
): Promise<{ interruptResolved: boolean; resultSeen: boolean; subtype: string; streamingSeen: boolean }> {
  let release!: () => void
  const hold = new Promise<void>((resolveHold) => {
    release = resolveHold
  })
  async function* prompts(): AsyncGenerator<SDKUserMessage, void> {
    yield {
      type: 'user',
      message: { role: 'user', content: PROMPT_INTERRUPT },
      parent_tool_use_id: null
    }
    await hold
  }

  const controller = new AbortController()
  let interruptResolved = false
  let resultSeen = false
  let subtype = 'none'
  let scheduled = false
  let streamingSeen = false
  let interruptTimer: NodeJS.Timeout | null = null
  const hardTimeout = setTimeout(() => {
    release()
    controller.abort()
  }, 45_000)
  const session = query({
    prompt: prompts(),
    options: {
      cwd,
      model: process.env.CLAUDE_PROBE_MODEL ?? 'claude-sonnet-5',
      maxTurns: 4,
      permissionMode: 'default',
      settingSources: [],
      includePartialMessages: true,
      canUseTool: permissionRecorder(record),
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: configDir,
        CLAUDE_AGENT_SDK_CLIENT_APP: 'agent2live-phase0-probe'
      },
      abortController: controller
    }
  })

  try {
    for await (const message of session) {
      if (message.type === 'stream_event') {
        streamingSeen = true
      }
      if (!scheduled && (message.type === 'system' || message.type === 'assistant')) {
        scheduled = true
        interruptTimer = setTimeout(() => {
          void session
            .interrupt()
            .then(() => {
              interruptResolved = true
            })
            .catch(() => {
              interruptResolved = false
            })
            .finally(() => release())
        }, 1200)
      }
      if (message.type === 'result') {
        resultSeen = true
        subtype = message.subtype
        release()
      }
    }
  } finally {
    if (interruptTimer) clearTimeout(interruptTimer)
    clearTimeout(hardTimeout)
    release()
  }
  return { interruptResolved, resultSeen, subtype, streamingSeen }
}

async function main(): Promise<number> {
  const started = Date.now()
  const startedAt = new Date(started).toISOString()
  const auth = authSource(process.env)
  const checks: AgentProbeChecks = {
    launch: false,
    turn: false,
    resume: false,
    interrupt: false,
    approval: false,
    streaming: false
  }
  let blocker: string | null = null
  let sessionRef: string | null = null
  let resultSubtype: string | null = null
  let tokenMatched: boolean | null = null
  let interruptResolved = false
  let approvalCount = 0
  let allowedApprovalCount = 0
  const sdkVersion = packageVersion('@anthropic-ai/claude-agent-sdk')
  const workspace = mkdtempSync(join(tmpdir(), 'agent2live-claude-probe-'))
  const configDir = join(workspace, '.claude-config')
  mkdirSync(configDir, { recursive: true })

  const finish = (status: 'pass' | 'fail' | 'blocked', code: string | null): number => {
    if (code) blocker = code
    const report: AgentProbeReport = {
      schemaVersion: 'agent-probe/1',
      provider: 'claude',
      status,
      blocker,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      checks,
      metrics: {
        approvalCount,
        allowedApprovalCount,
        notificationTypes: [],
        sessionRef: shortHash(sessionRef),
        threadRef: null,
        resultSubtype,
        tokenMatched,
        interruptResolved
      },
      env: {
        providerVersion: sdkVersion,
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        authSource: auth
      }
    }
    writeProbeReport('claude', report)
    console.log(
      JSON.stringify({
        provider: 'claude',
        status,
        blocker,
        evidence: 'docs/plans/evidence/phase0/G0-AGENT/claude.json'
      })
    )
    return status === 'pass' ? 0 : status === 'blocked' ? 2 : 1
  }

  if (!auth) {
    rmSync(workspace, { recursive: true, force: true })
    return finish('blocked', 'CLAUDE_AUTH_MISSING')
  }

  const approvals = { count: 0, allowed: 0 }
  try {
    const first = await runTextQuery(PROMPT_APPROVAL, {
      cwd: workspace,
      configDir,
      canUseTool: permissionRecorder(approvals),
      controller: new AbortController()
    })
    approvalCount = approvals.count
    allowedApprovalCount = approvals.allowed
    resultSubtype = first.subtype
    checks.launch = first.initSeen
    checks.streaming = first.initSeen
    checks.turn = first.subtype === 'success'
    checks.approval = approvals.allowed > 0
    tokenMatched = /CLAUDE_OK/i.test(first.text)
    if (!first.sessionId) return finish('blocked', 'CLAUDE_SESSION_NOT_RETURNED')
    sessionRef = first.sessionId
    if (!checks.turn) {
      const code =
        first.subtype === 'error_during_execution'
          ? 'CLAUDE_QUERY_FAILED'
          : `CLAUDE_${first.subtype.toUpperCase()}`
      return finish('fail', code)
    }
    if (!checks.approval) return finish('fail', 'CLAUDE_APPROVAL_NOT_OBSERVED')
    if (!tokenMatched) return finish('fail', 'CLAUDE_OUTPUT_MISMATCH')

    const resumed = await runTextQuery(PROMPT_RESUME, {
      cwd: workspace,
      configDir,
      resume: first.sessionId,
      controller: new AbortController()
    })
    resultSubtype = resumed.subtype
    checks.resume = resumed.subtype === 'success' && resumed.sessionId === first.sessionId
    if (!checks.resume) return finish('fail', 'CLAUDE_RESUME_FAILED')

    const interrupted = await runInterruptQuery(workspace, configDir, approvals)
    approvalCount = approvals.count
    allowedApprovalCount = approvals.allowed
    interruptResolved = interrupted.interruptResolved
    checks.interrupt = interrupted.interruptResolved
    checks.streaming = interrupted.streamingSeen
    if (!interrupted.resultSeen) return finish('fail', 'CLAUDE_INTERRUPT_NO_RESULT')
    resultSubtype = interrupted.subtype

    const status = statusFromChecks(checks)
    return finish(status, status === 'pass' ? null : 'CLAUDE_CHECKS_INCOMPLETE')
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/auth|api.?key|credit|login|unauthorized/i.test(message)) {
      return finish('blocked', 'CLAUDE_AUTH_FAILED')
    }
    if (/abort/i.test(message)) return finish('fail', 'CLAUDE_QUERY_TIMEOUT')
    return finish('fail', 'CLAUDE_PROBE_ERROR')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch(() => {
    process.exitCode = 1
  })
