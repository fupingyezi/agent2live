import { join } from 'node:path'
import { buildApp } from './app'
import { loadConfig } from './config'
import { openDatabase } from './db/client'
import { migrate } from './db/migrate'
import { removeEndpointFile, writeEndpointFile } from './endpoint'
import { EventStore } from './events/store'
import { BrokerSecretResolver, type BrokerPort } from './services/broker-resolver'
import { systemClock } from './services/clock'
import { createServices } from './services/container'
import { StaticSecretResolver, type SecretResolver } from './services/secret-resolver'

interface ParentPort {
  postMessage(message: unknown): void
  on(event: 'message', listener: (event: { data: unknown }) => void): void
}

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort
const secrets: SecretResolver = parentPort
  ? new BrokerSecretResolver({
      postMessage: (message) => parentPort.postMessage(message),
      onMessage: (listener) => parentPort.on('message', (event) => listener(event.data))
    } satisfies BrokerPort)
  : new StaticSecretResolver(new Map())

async function main(): Promise<void> {
  const config = loadConfig()
  const db = openDatabase(join(config.dataDir, 'app.sqlite'))
  migrate(db, config.migrationsDir)
  const eventStore = new EventStore(db)
  const services = createServices({
    db,
    dataDir: config.dataDir,
    events: eventStore,
    clock: systemClock,
    secrets
  })
  const app = buildApp({
    token: config.token,
    dataDir: config.dataDir,
    db,
    eventStore,
    services
  })
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
