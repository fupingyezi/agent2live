import { existsSync, realpathSync, statSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'

const ALLOWED = new Set(['.json', '.moc3', '.png', '.jpg', '.jpeg', '.webp', '.wav', '.mp3', '.ogg'])

const TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.moc3': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg'
}

export function contentTypeFor(file: string): string | null {
  return TYPES[extname(file).toLowerCase()] ?? null
}

/**
 * Parses an `agent2live-model://models/<relative-path>` request URL into the
 * relative path consumed by {@link resolveContainedFile}. Returns null for any
 * malformed URL, unexpected scheme/host, or malformed percent-encoding.
 */
export function modelPathFromUrl(rawUrl: string): string | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'agent2live-model:') return null
  if (url.host !== 'models') return null
  let path: string
  try {
    path = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  } catch {
    return null
  }
  return path.length > 0 ? path : null
}

export function resolveContainedFile(root: string, relativePath: string): string | null {
  try {
    if (!relativePath || relativePath.includes('\0') || relativePath.includes('\\')) return null
    const ext = extname(relativePath).toLowerCase()
    if (!ALLOWED.has(ext)) return null
    if (relativePath.startsWith('/') || isAbsolute(relativePath)) return null
    const rootAbs = resolve(root)
    const rootReal = realpathSync(rootAbs)
    if (!statSync(rootReal).isDirectory()) return null
    const target = resolve(rootAbs, relativePath)
    const rel = relative(rootAbs, target)
    if (!rel || rel.startsWith('..') || rel.split(sep).includes('..')) return null
    if (!existsSync(target) || !statSync(target).isFile()) return null
    const targetReal = realpathSync(target)
    const relReal = relative(rootReal, targetReal)
    if (!relReal || relReal.startsWith('..')) return null
    return target
  } catch {
    return null
  }
}
