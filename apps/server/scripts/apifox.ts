import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertOpenApiCurrent } from '../openapi/pipeline'
import { importOpenApiToApifox, readApifoxEnvFile, type CommandRunner } from './apifox-lib'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const envFile = process.env.APIFOX_ENV_FILE ?? resolve(HERE, '../../../.env')

const runCommand: CommandRunner = (bin, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })

async function main(): Promise<void> {
  const env = readApifoxEnvFile(envFile)
  await importOpenApiToApifox({
    env,
    dryRun: process.argv.includes('--dry-run'),
    runner: runCommand,
    validate: assertOpenApiCurrent,
    log: (line) => console.log(line)
  })
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
