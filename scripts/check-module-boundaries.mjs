import ts from 'typescript'
import { posix } from 'node:path'

import { compareViolations, isDirectRun, lineNumber, runCheck, scriptKindFor } from './code-style-shared.mjs'

const COMPONENT_BARRELS = new Set([
  'apps/desktop/src/renderer/studio/components/index.ts',
  'apps/desktop/src/renderer/studio/workbench/components/index.ts',
  'packages/design-system/src/patterns/index.ts'
])

const PUBLIC_MODULE_ALIASES = [
  '@desktop/shared',
  '@renderer/shared',
  '@studio/api',
  '@studio/components',
  '@studio/hooks',
  '@studio/providers',
  '@studio/routes',
  '@studio/workbench/components',
  '@studio/workbench'
].sort((left, right) => right.length - left.length)

const RENDERER_ALIASES = ['@renderer/', '@studio/']
const STUDIO_MODULES = new Set(['api', 'components', 'hooks', 'providers', 'routes', 'workbench'])
const STUDIO_PREFIX = 'apps/desktop/src/renderer/studio/'

function isComponentBarrel(path) {
  return (
    COMPONENT_BARRELS.has(path) || /^packages\/design-system\/src\/primitives\/[^/]+\/index\.ts$/.test(path)
  )
}

function hasJsDoc(text, node) {
  const comments = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []
  return comments.some((comment) => {
    const content = text.slice(comment.pos, comment.end).trim()
    return content.startsWith('/**') && content.replace(/[/*\s]/g, '').length > 0
  })
}

function resolvedImport(file, specifier) {
  return posix.normalize(posix.join(posix.dirname(file.path), specifier))
}

function studioModule(file) {
  if (!file.path.startsWith(STUDIO_PREFIX)) return null
  const [name] = file.path.slice(STUDIO_PREFIX.length).split('/')
  return name && STUDIO_MODULES.has(name) ? name : null
}

function scanBarrel(file, sourceFile, violations) {
  if (!isComponentBarrel(file.path)) return

  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement)) continue
    if (!statement.exportClause) {
      violations.push({
        path: file.path,
        line: lineNumber(sourceFile, statement.getStart(sourceFile)),
        rule: 'barrel-export-star'
      })
      continue
    }
    if (statement.isTypeOnly || hasJsDoc(file.content, statement)) continue
    violations.push({
      path: file.path,
      line: lineNumber(sourceFile, statement.getStart(sourceFile)),
      rule: 'barrel-missing-jsdoc'
    })
  }
}

function scanImports(file, sourceFile, violations) {
  const isElectronBoundary =
    file.path.startsWith('apps/desktop/src/main/') || file.path.startsWith('apps/desktop/src/preload/')

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const specifier = statement.moduleSpecifier.text
    const line = lineNumber(sourceFile, statement.getStart(sourceFile))
    const relativeTarget = specifier.startsWith('.') ? resolvedImport(file, specifier) : null

    if (
      isElectronBoundary &&
      (RENDERER_ALIASES.some((prefix) => specifier.startsWith(prefix)) ||
        relativeTarget?.startsWith('apps/desktop/src/renderer/'))
    ) {
      violations.push({ path: file.path, line, rule: 'process-boundary' })
    }

    const deepAlias = PUBLIC_MODULE_ALIASES.includes(specifier)
      ? undefined
      : PUBLIC_MODULE_ALIASES.find((alias) => specifier.startsWith(`${alias}/`))
    if (deepAlias) {
      violations.push({ path: file.path, line, rule: 'barrel-deep-import' })
    }

    const module = studioModule(file)
    if (module && relativeTarget && !relativeTarget.startsWith(`${STUDIO_PREFIX}${module}/`)) {
      violations.push({ path: file.path, line, rule: 'barrel-relative-import' })
    }
  }
}

export function scanModuleBoundaries(files) {
  const violations = []
  for (const file of files) {
    const sourceFile = ts.createSourceFile(
      file.path,
      file.content,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(file.path)
    )
    scanBarrel(file, sourceFile, violations)
    scanImports(file, sourceFile, violations)
  }
  return violations.sort(compareViolations)
}

function runCli() {
  runCheck({ roots: ['apps', 'packages'], extensions: ['.ts', '.tsx'] }, scanModuleBoundaries)
}

if (isDirectRun(import.meta.url)) runCli()
