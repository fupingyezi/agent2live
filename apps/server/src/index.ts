import { join } from 'node:path'
import { buildApp } from './app'
import { loadConfig } from './config'
import { openDatabase } from './db/client'
import { migrate } from './db/migrate'
import { removeEndpointFile, writeEndpointFile } from './endpoint'

async function main(): Promise<void> {
  const config = loadConfig()
  const db = openDatabase(join(config.dataDir, 'app.sqlite'))
  migrate(db, config.migrationsDir)
  const app = buildApp({ token: config.token, dataDir: config.dataDir, db })
  const endpointFile = join(config.dataDir, 'runtime', 'endpoint.json')
  const address = await app.listen({ host: '127.0.0.1', port: config.port })
  const port = new URL(address).port
  const baseUrl = `http://127.0.0.1:${port}`
  writeEndpointFile(endpointFile, {
    baseUrl,
    token: config.token,
    pid: process.pid,
    startedAt: config.startedAt
  })

  let closing = false
  const shutdown = async (): Promise<void> => {
    if (closing) return
    closing = true
    removeEndpointFile(endpointFile)
    await app.close()
    db.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
