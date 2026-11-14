import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const root = resolve(process.cwd())
const evidenceRoot = resolve(root, 'docs', 'plans', 'evidence', 'phase1')

function safePath(parts: string[]): string {
  const target = resolve(evidenceRoot, ...parts)
  if (target !== evidenceRoot && !target.startsWith(`${evidenceRoot}${sep}`)) {
    throw new Error(`evidence path escapes phase1 directory: ${target}`)
  }
  return target
}

export function phase1EvidencePath(...parts: string[]): string {
  return safePath(parts)
}

export function ensureEvidenceDir(...parts: string[]): string {
  const target = safePath(parts)
  mkdirSync(target, { recursive: true })
  return target
}

export function writeEvidenceJson(name: string, value: unknown): string {
  const target = safePath([name])
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  return target
}

export function writeEvidenceBytes(name: string, bytes: Uint8Array): string {
  const target = safePath([name])
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, bytes, { mode: 0o600 })
  return target
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function evidenceRelativePath(absolutePath: string): string {
  const relativePath = relative(root, absolutePath)
  if (relativePath.startsWith('..') || resolve(root, relativePath) !== resolve(absolutePath)) {
    throw new Error(`path is outside repository: ${absolutePath}`)
  }
  return relativePath.split(sep).join('/')
}
