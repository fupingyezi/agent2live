import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomToken } from './auth'

export interface ServerConfig {
  dataDir: string
  migrationsDir: string
  port: number
  token: string
  startedAt: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const dataDir = env.AGENT2LIVE_DATA_DIR
  if (!dataDir) throw new Error('AGENT2LIVE_DATA_DIR is required')
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  mkdirSync(join(dataDir, 'runtime'), { recursive: true, mode: 0o700 })
  const rawPort = Number(env.AGENT2LIVE_PORT ?? '0')
  if (!Number.isInteger(rawPort) || rawPort < 0 || rawPort > 65535) {
    throw new Error('AGENT2LIVE_PORT must be an integer in [0, 65535]')
  }
  return {
    dataDir,
    migrationsDir: env.AGENT2LIVE_MIGRATIONS_DIR ?? join(__dirname, '..', 'migrations'),
    port: rawPort,
    token: env.AGENT2LIVE_TOKEN ?? randomToken(),
    startedAt: new Date().toISOString()
  }
}
