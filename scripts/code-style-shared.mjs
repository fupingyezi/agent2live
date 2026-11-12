import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

export const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'out',
  'release',
  '.packaged-server',
  'docs',
  '.git',
  '.superpowers',
  'test-results',
  'playwright-report'
])

export function lineNumber(sourceFile, position) {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1
}

export function compareViolations(left, right) {
  if (left.path !== right.path) return left.path < right.path ? -1 : 1
  if (left.line !== right.line) return left.line - right.line
  if (left.rule !== right.rule) return left.rule < right.rule ? -1 : 1
  return 0
}

export function scriptKindFor(path) {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (path.endsWith('.mjs') || path.endsWith('.js')) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

export function relativePath(absolute, baseDir = ROOT) {
  return relative(baseDir, absolute).split(sep).join('/')
}

function walkEntries(directory, entries, extensions, output) {
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue
      walkEntries(absolute, readdirSync(absolute, { withFileTypes: true }), extensions, output)
    } else if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
      output.push(absolute)
    }
  }
}

export function discoverFiles({ baseDir = ROOT, roots = [], extensions = [], baseFileExtensions = [] } = {}) {
  const files = []
  for (const root of roots) {
    const absoluteRoot = resolve(baseDir, root)
    let entries
    try {
      entries = readdirSync(absoluteRoot, { withFileTypes: true })
    } catch (error) {
      if (error && error.code === 'ENOENT') throw new Error(`CODE_STYLE_ROOT_MISSING:${root}`)
      throw error
    }
    walkEntries(absoluteRoot, entries, extensions, files)
  }
  if (baseFileExtensions.length > 0) {
    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue
      if (baseFileExtensions.some((extension) => entry.name.endsWith(extension))) {
        files.push(join(baseDir, entry.name))
      }
    }
  }
  if (files.length === 0) throw new Error('CODE_STYLE_NO_FILES')
  files.sort()
  return files
}

export function loadFiles(absoluteFiles, baseDir = ROOT) {
  return absoluteFiles.map((absolute) => ({
    path: relativePath(absolute, baseDir),
    content: readFileSync(absolute, 'utf8')
  }))
}

export function exitCodeForViolations(violations) {
  return violations.length > 0 ? 1 : 0
}

export function reportViolations(violations, log = console.log) {
  for (const violation of violations) log(`${violation.path}:${violation.line} ${violation.rule}`)
  log(`${violations.length} violation(s)`)
  return exitCodeForViolations(violations)
}

export function isDirectRun(metaUrl) {
  const invoked = process.argv[1]
  return invoked !== undefined && resolve(invoked) === fileURLToPath(metaUrl)
}

export function runCheck(config, scan) {
  const baseDir = config.baseDir ?? ROOT
  const violations = scan(loadFiles(discoverFiles({ ...config, baseDir }), baseDir))
  process.exitCode = reportViolations(violations)
}
