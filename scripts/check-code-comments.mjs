import ts from 'typescript'

import { compareViolations, isDirectRun, lineNumber, runCheck, scriptKindFor } from './code-style-shared.mjs'

const COMMENT_ROOTS = ['apps', 'packages', 'scripts', 'e2e', 'spikes']
const COMMENT_EXTENSIONS = ['.ts', '.tsx', '.mjs']
const ROOT_EXTENSIONS = ['.ts', '.tsx', '.mjs']

const CONTEXT_PATTERNS = [/docs\//i, /Phase\s+\d/i, /Task\s+\d+/i, /ADR\s+\d+/i]
const CONTEXT_PHRASES = ['按计划', '按用户要求', '执行上下文']

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

export function scanCommentViolations(files) {
  const violations = []
  for (const file of files) scanFile(file, violations)
  return violations.sort(compareViolations)
}

function runCli() {
  runCheck(
    { roots: COMMENT_ROOTS, extensions: COMMENT_EXTENSIONS, baseFileExtensions: ROOT_EXTENSIONS },
    scanCommentViolations
  )
}

if (isDirectRun(import.meta.url)) runCli()
