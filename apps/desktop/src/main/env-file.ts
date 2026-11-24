import { existsSync, readFileSync } from 'node:fs'

interface EnvFileIo {
  existsSync(path: string): boolean
  readFileSync(path: string, encoding: 'utf8'): string
}

function stripQuotes(value: string): string {
  const wrapped =
    (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
  return wrapped && value.length >= 2 ? value.slice(1, -1) : value
}

export function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    values[key] = stripQuotes(line.slice(eq + 1).trim())
  }
  return values
}

export function resolveEnvValue(
  candidates: string[],
  key: string,
  io: EnvFileIo = { existsSync, readFileSync }
): string | null {
  const path = candidates.find((candidate) => io.existsSync(candidate))
  if (!path) return null
  try {
    return parseEnvFile(io.readFileSync(path, 'utf8'))[key] ?? null
  } catch {
    return null
  }
}
