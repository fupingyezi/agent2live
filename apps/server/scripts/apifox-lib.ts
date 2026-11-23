import { OPENAPI_OUTPUT } from '../openapi/pipeline'

export interface ApifoxEnv {
  token: string
  projectId: string
  branch?: string
  moduleMap?: string
}

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

export type CommandRunner = (bin: string, args: string[]) => Promise<CommandResult>

export function readApifoxEnv(env: NodeJS.ProcessEnv): ApifoxEnv {
  const token = env.APIFOX_ACCESS_TOKEN
  const projectId = env.APIFOX_PROJECT_ID
  if (!token) throw new Error('APIFOX_ACCESS_TOKEN is required')
  if (!projectId) throw new Error('APIFOX_PROJECT_ID is required')
  return {
    token,
    projectId,
    ...(env.APIFOX_BRANCH ? { branch: env.APIFOX_BRANCH } : {}),
    ...(env.APIFOX_MODULE_MAP ? { moduleMap: env.APIFOX_MODULE_MAP } : {})
  }
}

export function buildApifoxCommandPlan(
  env: ApifoxEnv,
  file: string
): { versionArgs: string[]; authArgs: string[]; importArgs: string[] } {
  const importArgs = [
    'import',
    '--project',
    env.projectId,
    '--format',
    'openapi',
    '--file',
    file,
    '--overwrite-mode',
    'merge'
  ]
  if (env.branch) importArgs.push('--branch', env.branch)
  if (env.moduleMap) importArgs.push('--module-map', env.moduleMap)
  return {
    versionArgs: ['--version'],
    authArgs: ['auth', 'login', '--with-token', env.token],
    importArgs
  }
}

export async function importOpenApiToApifox(options: {
  env: ApifoxEnv
  dryRun: boolean
  runner: CommandRunner
  validate: () => Promise<void>
  log: (line: string) => void
}): Promise<void> {
  await options.validate()
  const plan = buildApifoxCommandPlan(options.env, OPENAPI_OUTPUT)
  const redactedAuth = plan.authArgs.map((arg) => (arg === options.env.token ? '***' : arg))
  if (options.dryRun) {
    options.log(`apifox ${plan.versionArgs.join(' ')}`)
    options.log(`apifox ${redactedAuth.join(' ')}`)
    options.log(`apifox ${plan.importArgs.join(' ')}`)
    return
  }

  const version = await options.runner('apifox', plan.versionArgs)
  if (version.code !== 0) throw new Error(`apifox --version failed: ${version.stderr}`)

  const auth = await options.runner('apifox', plan.authArgs)
  if (auth.code !== 0) throw new Error(`apifox auth login failed: ${auth.stderr}`)

  const imported = await options.runner('apifox', plan.importArgs)
  if (imported.code !== 0) {
    throw new Error(
      `apifox import failed: ${imported.stderr}\n` +
        'If writes are restricted, configure APIFOX_BRANCH or confirm permissions in Apifox.'
    )
  }
  options.log(imported.stdout)
}
