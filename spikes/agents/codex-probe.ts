import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { JsonlRpcClient, type RpcNotification, type RpcServerRequest } from './lib/jsonl-rpc'
import {
  shortHash,
  statusFromChecks,
  writeProbeReport,
  type AgentProbeChecks,
  type AgentProbeReport
} from './lib/report'

interface TurnResult {
  status: string
  errorCode: string | null
}

interface TurnStartResult {
  turn: { id: string }
}

const PROMPT_APPROVAL =
  'Run exactly this shell command in the workspace using the shell tool: printf agent2live-codex-probe. Then reply with exactly: CODEX_OK.'
const PROMPT_RESUME = 'Reply with exactly: RESUME_OK.'
const PROMPT_INTERRUPT =
  'Run exactly this shell command in the workspace: sleep 30. Wait for it to finish, then reply with exactly: DONE.'

function cliVersion(): string | null {
  const result = spawnSync('codex', ['--version'], { encoding: 'utf8' })
  if (result.error || result.status !== 0) return null
  return result.stdout.trim().split(/\s+/).at(-1) ?? null
}

function isLoggedIn(): boolean {
  const result = spawnSync('codex', ['login', 'status'], { encoding: 'utf8' })
  if (result.error || result.status !== 0) return false
  const output = `${result.stdout}${result.stderr}`
  return /logged in/i.test(output) && !/not logged in/i.test(output)
}

function commandText(params: unknown): string {
  const record = params as { command?: unknown; commandActions?: unknown; parsedCmd?: unknown } | undefined
  if (typeof record?.command === 'string') return record.command
  if (Array.isArray(record?.command)) return record.command.map(String).join(' ')
  if (Array.isArray(record?.commandActions)) {
    return record.commandActions
      .map((action) => {
        const value = (action as { command?: unknown }).command
        return typeof value === 'string' ? value : ''
      })
      .filter(Boolean)
      .join(' ')
  }
  return ''
}

function isAllowedProbeCommand(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, ' ')
  return normalized === 'printf agent2live-codex-probe' || normalized === 'sleep 30'
}

function failureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message === 'CODEX_TURN_TIMEOUT') return 'CODEX_TURN_TIMEOUT'
  if (message.startsWith('RPC_TIMEOUT')) return 'CODEX_APP_SERVER_NO_RESPONSE'
  if (message.startsWith('RPC_REMOTE_ERROR')) return 'CODEX_RPC_REMOTE_ERROR'
  if (message.startsWith('RPC_CLOSED')) return 'CODEX_APP_SERVER_CLOSED'
  return 'CODEX_PROBE_ERROR'
}

function waitForCompletion(
  rpc: JsonlRpcClient,
  threadId: string,
  timeoutMs = 120_000
): Promise<{ turnId: string; result: TurnResult }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('CODEX_TURN_TIMEOUT'))
    }, timeoutMs)
    const onNotification = (notification: RpcNotification): void => {
      if (notification.method !== 'turn/completed') return
      const params = notification.params as {
        threadId?: string
        turn?: { id?: string; status?: string; error?: { message?: string } }
      }
      if (params.threadId !== threadId || !params.turn?.id) return
      cleanup()
      resolve({
        turnId: params.turn.id,
        result: {
          status: params.turn.status ?? 'unknown',
          errorCode: params.turn.error ? 'TURN_FAILED' : null
        }
      })
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      rpc.off('notification', onNotification)
    }
    rpc.on('notification', onNotification)
  })
}

async function main(): Promise<number> {
  const started = Date.now()
  const startedAt = new Date(started).toISOString()
  const version = cliVersion()
  const loggedIn = isLoggedIn()
  const workspace = mkdtempSync(join(tmpdir(), 'agent2live-codex-probe-'))
  const checks: AgentProbeChecks = {
    launch: false,
    turn: false,
    resume: false,
    interrupt: false,
    approval: false,
    streaming: false
  }
  const notifications = new Set<string>()
  let blocker: string | null = null
  let approvalCount = 0
  let allowedApprovalCount = 0
  let sessionRef: string | null = null
  let threadRef: string | null = null
  let resultSubtype: string | null = null
  let tokenMatched: boolean | null = null
  let interruptResolved = false
  let rpc: JsonlRpcClient | null = null
  let child: ReturnType<typeof spawn> | null = null
  let createdThreadId: string | null = null
  let assistantText = ''

  const finish = (status: 'pass' | 'fail' | 'blocked', code: string | null): number => {
    if (code) blocker = code
    const report: AgentProbeReport = {
      schemaVersion: 'agent-probe/1',
      provider: 'codex',
      status,
      blocker,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      checks,
      metrics: {
        approvalCount,
        allowedApprovalCount,
        notificationTypes: [...notifications].sort(),
        sessionRef,
        threadRef,
        resultSubtype,
        tokenMatched,
        interruptResolved
      },
      env: {
        providerVersion: version ?? 'missing',
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        authSource: loggedIn ? 'cli_login' : null
      }
    }
    writeProbeReport('codex', report)
    console.log(
      JSON.stringify({
        provider: 'codex',
        status,
        blocker,
        evidence: 'docs/plans/evidence/phase0/G0-AGENT/codex.json'
      })
    )
    return status === 'pass' ? 0 : status === 'blocked' ? 2 : 1
  }

  if (!version) {
    rmSync(workspace, { recursive: true, force: true })
    return finish('blocked', 'CODEX_CLI_MISSING')
  }

  try {
    child = spawn('codex', ['app-server', '--stdio'], {
      cwd: workspace,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    if (!child.stdout || !child.stdin) return finish('blocked', 'CODEX_STDIO_UNAVAILABLE')
    if (child.stderr) {
      createInterface({ input: child.stderr, crlfDelay: Infinity }).on('line', () => {
        // Drain stderr to avoid pipe backpressure; never persist it because it can contain paths.
      })
    }
    rpc = new JsonlRpcClient(child.stdin, child.stdout)
    rpc.on('protocolError', () => {
      // A malformed line invalidates the probe; the pending request will time out.
    })
    rpc.on('notification', (notification: RpcNotification) => {
      notifications.add(notification.method)
      if (notification.method === 'item/agentMessage/delta') {
        const params = notification.params as { delta?: unknown }
        if (typeof params.delta === 'string') assistantText += params.delta
      }
    })
    rpc.on('serverRequest', (request: RpcServerRequest) => {
      approvalCount += 1
      const allowed =
        (request.method === 'item/commandExecution/requestApproval' ||
          request.method === 'execCommandApproval') &&
        isAllowedProbeCommand(commandText(request.params))
      if (allowed) allowedApprovalCount += 1
      if (request.method === 'item/commandExecution/requestApproval') {
        rpc!.respond(request.id, { decision: allowed ? 'accept' : 'decline' })
      } else if (request.method === 'item/fileChange/requestApproval') {
        rpc!.respond(request.id, { decision: 'decline' })
      } else if (request.method === 'execCommandApproval') {
        rpc!.respond(request.id, { decision: allowed ? 'approved' : 'denied' })
      } else if (request.method === 'applyPatchApproval') {
        rpc!.respond(request.id, { decision: 'denied' })
      } else {
        rpc!.respondError(request.id, -32601, 'unsupported server request')
      }
    })

    await rpc.request(
      'initialize',
      {
        clientInfo: { name: 'agent2live-phase0-probe', title: 'Agent2Live Phase 0 Probe', version: '0.1.0' },
        capabilities: { experimentalApi: false }
      },
      15_000
    )
    rpc.notify('initialized')
    checks.launch = true

    if (!isLoggedIn()) {
      return finish('blocked', 'CODEX_NOT_LOGGED_IN')
    }

    const thread = await rpc.request<{ thread: { id: string } }>(
      'thread/start',
      {
        cwd: workspace,
        approvalPolicy: 'untrusted',
        sandbox: 'workspace-write',
        ephemeral: false
      },
      30_000
    )
    const threadId = thread.thread.id
    createdThreadId = threadId
    threadRef = shortHash(threadId)
    sessionRef = shortHash(threadId)

    assistantText = ''
    const firstCompletion = waitForCompletion(rpc, threadId)
    const firstTurn = await rpc.request<TurnStartResult>(
      'turn/start',
      {
        threadId,
        input: [{ type: 'text', text: PROMPT_APPROVAL }]
      },
      30_000
    )
    const first = await firstCompletion
    resultSubtype = first.result.status
    checks.turn = first.result.status === 'completed'
    checks.approval = allowedApprovalCount > 0
    if (firstTurn.turn.id !== first.turnId) return finish('fail', 'CODEX_TURN_ID_MISMATCH')
    tokenMatched = first.result.status === 'completed' && /CODEX_OK/i.test(assistantText)
    if (!checks.turn) return finish('fail', first.result.errorCode ?? 'CODEX_TURN_FAILED')
    if (!checks.approval) return finish('fail', 'CODEX_APPROVAL_NOT_OBSERVED')
    if (!tokenMatched) return finish('fail', 'CODEX_OUTPUT_MISMATCH')

    const resume = await rpc.request<{ thread: { id: string } }>('thread/resume', { threadId }, 30_000)
    const resumeRequestOk = resume.thread?.id === threadId
    if (!resumeRequestOk) return finish('fail', 'CODEX_RESUME_FAILED')
    assistantText = ''
    const resumedCompletion = waitForCompletion(rpc, threadId)
    await rpc.request<TurnStartResult>(
      'turn/start',
      {
        threadId,
        input: [{ type: 'text', text: PROMPT_RESUME }]
      },
      30_000
    )
    const resumed = await resumedCompletion
    checks.resume =
      resumeRequestOk && resumed.result.status === 'completed' && /RESUME_OK/i.test(assistantText)
    if (!checks.resume) return finish('fail', 'CODEX_RESUME_TURN_FAILED')

    const interruptCompletion = waitForCompletion(rpc, threadId)
    const interruptTurn = await rpc.request<TurnStartResult>(
      'turn/start',
      {
        threadId,
        input: [{ type: 'text', text: PROMPT_INTERRUPT }]
      },
      30_000
    )
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000))
    await rpc.request('turn/interrupt', { threadId, turnId: interruptTurn.turn.id }, 30_000)
    interruptResolved = true
    const interrupted = await interruptCompletion
    resultSubtype = interrupted.result.status
    checks.interrupt = interrupted.result.status === 'interrupted'
    checks.streaming = notifications.has('turn/started') && notifications.has('turn/completed')
    if (!checks.interrupt) return finish('fail', 'CODEX_INTERRUPT_NOT_HONORED')

    const status = statusFromChecks(checks)
    return finish(status, status === 'pass' ? null : 'CODEX_CHECKS_INCOMPLETE')
  } catch (error) {
    const code = failureCode(error)
    if (code === 'CODEX_APP_SERVER_NO_RESPONSE' || code === 'CODEX_APP_SERVER_CLOSED') {
      return finish('blocked', code)
    }
    return finish('fail', code)
  } finally {
    if (rpc !== null && createdThreadId !== null) {
      try {
        await rpc.request('thread/delete', { threadId: createdThreadId }, 5000)
      } catch {
        // Best-effort cleanup; a cleanup failure must not change the gate outcome.
      }
    }
    rpc?.close()
    child?.kill('SIGTERM')
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
