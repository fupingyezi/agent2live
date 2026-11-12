import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const COMMENT_ROOTS = ['apps', 'packages', 'scripts', 'e2e', 'spikes']
const COMMENT_EXTENSIONS = ['.ts', '.tsx', '.mjs']
const ROOT_EXTENSIONS = ['.ts', '.mjs']
const EXCLUDED_DIRS = new Set([
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

const CONTEXT_PATTERNS = [/docs\//i, /Phase\s+\d/i, /Task\s+\d+/i, /ADR\s+\d+/i]
const CONTEXT_PHRASES = ['按计划', '按用户要求', '执行上下文']

function lineNumber(sourceFile, position) {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1
}

function compareViolations(left, right) {
  if (left.path !== right.path) return left.path < right.path ? -1 : 1
  if (left.line !== right.line) return left.line - right.line
  if (left.rule !== right.rule) return left.rule < right.rule ? -1 : 1
  return 0
}

function scriptKindFor(path) {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (path.endsWith('.mjs') || path.endsWith('.js')) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function collectComments(sourceFile, text) {
  const found = new Map()
  const visit = (node) => {
    const leading = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []
    const trailing = ts.getTrailingCommentRanges(text, node.getEnd()) ?? []
    for (const range of [...leading, ...trailing]) {
      found.set(`${range.pos}:${range.end}`, range)
    }
    for (const child of node.getChildren(sourceFile)) visit(child)
  }
  visit(sourceFile)
  return [...found.values()]
}

function isContextComment(text) {
  if (CONTEXT_PATTERNS.some((pattern) => pattern.test(text))) return true
  return CONTEXT_PHRASES.some((phrase) => text.includes(phrase))
}

function scanFile(file, violations) {
  const sourceFile = ts.createSourceFile(
    file.path,
    file.content,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file.path)
  )
  for (const range of collectComments(sourceFile, file.content)) {
    const text = file.content.slice(range.pos, range.end)
    if (!isContextComment(text)) continue
    violations.push({ path: file.path, line: lineNumber(sourceFile, range.pos), rule: 'comment-context' })
  }
}

function collectFiles(directory, extensions, output) {
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue
      collectFiles(absolute, extensions, output)
    } else if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
      output.push(absolute)
    }
  }
}

function collectRootFiles(output) {
  let entries
  try {
    entries = readdirSync(ROOT, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue
    if (ROOT_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      output.push(join(ROOT, entry.name))
    }
  }
}

function relativePath(absolute) {
  return relative(ROOT, absolute).split(sep).join('/')
}

export function scanCommentViolations(files) {
  const violations = []
  for (const file of files) scanFile(file, violations)
  return violations.sort(compareViolations)
}

function runCheck() {
  const absoluteFiles = []
  for (const root of COMMENT_ROOTS) collectFiles(join(ROOT, root), COMMENT_EXTENSIONS, absoluteFiles)
  collectRootFiles(absoluteFiles)
  absoluteFiles.sort()
  const files = absoluteFiles.map((absolute) => ({
    path: relativePath(absolute),
    content: readFileSync(absolute, 'utf8')
  }))
  const violations = scanCommentViolations(files)
  for (const violation of violations) console.log(`${violation.path}:${violation.line} ${violation.rule}`)
  console.log(`${violations.length} violation(s)`)
  process.exitCode = violations.length > 0 ? 1 : 0
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1])
if (invokedPath === fileURLToPath(import.meta.url)) runCheck()
