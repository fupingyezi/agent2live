import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { sidecarEndpointFileSchema, type SidecarEndpointFile } from '@agent2live/contracts'

export const endpointSchema = sidecarEndpointFileSchema

export type EndpointFile = SidecarEndpointFile

export function writeEndpointFile(file: string, input: Omit<EndpointFile, 'schemaVersion'>): EndpointFile {
  const value: EndpointFile = endpointSchema.parse({ schemaVersion: 'endpoint/1', ...input })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, file)
  return value
}

export function readEndpointFile(file: string): EndpointFile {
  if (!existsSync(file)) throw new Error(`endpoint file not found: ${file}`)
  return endpointSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
}

export function removeEndpointFile(file: string): void {
  if (!existsSync(file)) return
  try {
    const current = readEndpointFile(file)
    if (current.pid === process.pid) rmSync(file, { force: true })
  } catch {
    rmSync(file, { force: true })
  }
}
