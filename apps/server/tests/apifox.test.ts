import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  buildApifoxCommandPlan,
  importOpenApiToApifox,
  readApifoxEnv,
  readApifoxEnvFile,
  type CommandRunner
} from '../scripts/apifox-lib'

describe('apifox import wrapper', () => {
  it('requires token and project id', () => {
    expect(() => readApifoxEnv({})).toThrow(/APIFOX_ACCESS_TOKEN/)
    expect(() => readApifoxEnv({ APIFOX_ACCESS_TOKEN: 'token' })).toThrow(/APIFOX_PROJECT_ID/)
  })

  it('reads Apifox credentials from an env file, letting process env win', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent2live-apifox-'))
    const file = join(dir, '.env')
    try {
      writeFileSync(file, 'APIFOX_ACCESS_TOKEN=file-token\nAPIFOX_PROJECT_ID=file-project\n')
      expect(readApifoxEnvFile(file, {})).toEqual({
        token: 'file-token',
        projectId: 'file-project'
      })
      expect(readApifoxEnvFile(file, { APIFOX_ACCESS_TOKEN: 'shell-token' })).toMatchObject({
        token: 'shell-token',
        projectId: 'file-project'
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('plans an explicit merge import with branch and module map', () => {
    const plan = buildApifoxCommandPlan(
      { token: 'secret-token', projectId: 'project-1', branch: 'ai-1', moduleMap: 'a=b' },
      '/tmp/openapi.json'
    )
    expect(plan.authArgs).toEqual(['auth', 'login', '--with-token', 'secret-token'])
    expect(plan.importArgs).toContain('--overwrite-mode')
    expect(plan.importArgs).toContain('merge')
    expect(plan.importArgs).toContain('--branch')
    expect(plan.importArgs).toContain('--module-map')
  })

  it('does not call the network on dry-run and redacts the token', async () => {
    const runner: CommandRunner = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }))
    const logs: string[] = []
    await importOpenApiToApifox({
      env: { token: 'secret-token', projectId: 'project-1' },
      dryRun: true,
      runner,
      validate: async () => undefined,
      log: (line) => logs.push(line)
    })
    expect(runner).not.toHaveBeenCalled()
    expect(logs.join('\n')).not.toContain('secret-token')
    expect(logs.join('\n')).toContain('***')
  })

  it('surfaces CLI stdout when import fails', async () => {
    const runner: CommandRunner = async (_bin, args) => {
      if (args[0] === 'auth') return { code: 0, stdout: '', stderr: '' }
      if (args[0] === 'import') {
        return { code: 1, stdout: 'permission denied: no write access', stderr: '' }
      }
      return { code: 0, stdout: '2.2.12', stderr: '' }
    }
    await expect(
      importOpenApiToApifox({
        env: { token: 'secret-token', projectId: 'project-1' },
        dryRun: false,
        runner,
        validate: async () => undefined,
        log: () => undefined
      })
    ).rejects.toThrow(/permission denied/)
  })

  it('stops before import when auth fails', async () => {
    const calls: Array<{ bin: string; args: string[] }> = []
    const runner: CommandRunner = async (bin, args) => {
      calls.push({ bin, args })
      return { code: args[0] === 'auth' ? 1 : 0, stdout: '', stderr: 'auth failed' }
    }
    await expect(
      importOpenApiToApifox({
        env: { token: 'secret-token', projectId: 'project-1' },
        dryRun: false,
        runner,
        validate: async () => undefined,
        log: () => undefined
      })
    ).rejects.toThrow(/auth login failed/)
    expect(calls.some((call) => call.args[0] === 'import')).toBe(false)
  })
})
