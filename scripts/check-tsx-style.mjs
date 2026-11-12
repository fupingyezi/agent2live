import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const TSX_ROOTS = ['apps', 'packages']
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

function isUppercaseName(name) {
  return /^[A-Z]/.test(name)
}

function wrapperName(expression) {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}

function functionLikeFromInitializer(initializer) {
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
    return { fn: initializer, call: undefined }
  }
  if (!ts.isCallExpression(initializer)) return undefined
  const name = wrapperName(initializer.expression)
  if (name !== 'memo' && name !== 'forwardRef') return undefined
  const [first] = initializer.arguments
  if (!first || (!ts.isArrowFunction(first) && !ts.isFunctionExpression(first))) return undefined
  return { fn: first, call: initializer }
}

function componentFromStatement(statement) {
  if (ts.isFunctionDeclaration(statement)) {
    if (!statement.name || !isUppercaseName(statement.name.text)) return undefined
    return { fn: statement, call: undefined }
  }
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !isUppercaseName(declaration.name.text)) continue
      if (!declaration.initializer) continue
      const found = functionLikeFromInitializer(declaration.initializer)
      if (found) return found
    }
  }
  return undefined
}

function hasTypedParameter(fn) {
  return fn.parameters.some((parameter) => parameter.type !== undefined)
}

function hasPropsGeneric(call) {
  if (!call) return false
  const typeArguments = call.typeArguments ?? call.typeParameters
  return Boolean(typeArguments && typeArguments.length > 0)
}

function scanComponents(file, sourceFile, violations) {
  for (const statement of sourceFile.statements) {
    const component = componentFromStatement(statement)
    if (!component) continue
    if (hasPropsGeneric(component.call)) continue
    if (!hasTypedParameter(component.fn)) continue
    violations.push({
      path: file.path,
      line: lineNumber(sourceFile, statement.getStart(sourceFile)),
      rule: 'component-props'
    })
  }
}

function scanSpacing(file, sourceFile, violations) {
  const lines = file.content.split(/\r?\n/)
  const statements = sourceFile.statements
  for (let index = 1; index < statements.length; index += 1) {
    const previous = statements[index - 1]
    const current = statements[index]
    if (ts.isImportDeclaration(previous) && ts.isImportDeclaration(current)) continue
    const previousEnd = lineNumber(sourceFile, previous.getEnd())
    const currentStart = lineNumber(sourceFile, current.getStart(sourceFile))
    let separated = false
    for (let line = previousEnd + 1; line < currentStart; line += 1) {
      if ((lines[line - 1] ?? '').trim() === '') {
        separated = true
        break
      }
    }
    if (!separated) {
      violations.push({ path: file.path, line: currentStart, rule: 'module-spacing' })
    }
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

function relativePath(absolute) {
  return relative(ROOT, absolute).split(sep).join('/')
}

export function scanTsxStyle(files) {
  const violations = []
  for (const file of files) {
    const sourceFile = ts.createSourceFile(
      file.path,
      file.content,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(file.path)
    )
    scanComponents(file, sourceFile, violations)
    scanSpacing(file, sourceFile, violations)
  }
  return violations.sort(compareViolations)
}

function runCheck() {
  const absoluteFiles = []
  for (const root of TSX_ROOTS) collectFiles(join(ROOT, root), ['.tsx'], absoluteFiles)
  absoluteFiles.sort()
  const files = absoluteFiles.map((absolute) => ({
    path: relativePath(absolute),
    content: readFileSync(absolute, 'utf8')
  }))
  const violations = scanTsxStyle(files)
  for (const violation of violations) console.log(`${violation.path}:${violation.line} ${violation.rule}`)
  console.log(`${violations.length} violation(s)`)
  process.exitCode = violations.length > 0 ? 1 : 0
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1])
if (invokedPath === fileURLToPath(import.meta.url)) runCheck()
