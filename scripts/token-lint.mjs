#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TARGETS = ['apps/desktop/src/renderer']
const SOURCE_FILE = /\.(css|scss|tsx?)$/
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g
const COLOR_FUNCTION = /\b(?:rgba?|hsla?)\(/g
const ARBITRARY_RADIUS = /border-radius\s*:\s*(?!var\(--a2l-radius-)(?!0(?:px)?\b)(?!50%)\S[^;]*/
const DEEP_IMPORT = /(['"])@agent2live\/design-system\/(?!styles\.css\1)/

export function scanTokenViolations(files) {
  const violations = []
  for (const file of files) {
    if (!SOURCE_FILE.test(file.path)) continue
    const lines = file.content.split(/\r?\n/)
    lines.forEach((text, index) => {
      const line = index + 1
      const rawColors = (text.match(HEX_COLOR)?.length ?? 0) + (text.match(COLOR_FUNCTION)?.length ?? 0)
      for (let count = 0; count < rawColors; count += 1) {
        violations.push({ path: file.path, line, rule: 'raw-color', text: text.trim() })
      }
      if ((file.path.endsWith('.css') || file.path.endsWith('.scss')) && ARBITRARY_RADIUS.test(text)) {
        violations.push({ path: file.path, line, rule: 'arbitrary-radius', text: text.trim() })
      }
      if (DEEP_IMPORT.test(text)) {
        violations.push({ path: file.path, line, rule: 'deep-import', text: text.trim() })
      }
    })
  }
  return violations
}

function collect(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return collect(full)
    return SOURCE_FILE.test(entry.name) ? [full] : []
  })
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const files = TARGETS.flatMap((target) => collect(resolve(root, target))).map((full) => ({
    path: relative(root, full),
    content: readFileSync(full, 'utf8')
  }))
  const violations = scanTokenViolations(files)
  if (violations.length === 0) {
    console.log(`token lint: ${files.length} files passed`)
  } else {
    for (const violation of violations) {
      console.error(`${violation.path}:${violation.line} [${violation.rule}] ${violation.text}`)
    }
    process.exitCode = 1
  }
}
