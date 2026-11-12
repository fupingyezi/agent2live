import ts from 'typescript'

import { compareViolations, isDirectRun, lineNumber, runCheck, scriptKindFor } from './code-style-shared.mjs'

const TSX_ROOTS = ['apps', 'packages']

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

function maskCommentRanges(content, start, end) {
  const ranges = new Map()
  const candidates = [
    ...(ts.getLeadingCommentRanges(content, start) ?? []),
    ...(ts.getTrailingCommentRanges(content, start) ?? [])
  ]
  for (const range of candidates) ranges.set(`${range.pos}:${range.end}`, range)
  let masked = content.slice(start, end)
  const sorted = [...ranges.values()].sort((left, right) => right.pos - left.pos)
  for (const range of sorted) {
    if (range.pos < start || range.end > end) continue
    masked = `${masked.slice(0, range.pos - start)}x${masked.slice(range.end - start)}`
  }
  return masked
}

function hasSeparatingBlankLine(file, previous, current, sourceFile) {
  const start = previous.getEnd()
  const end = current.getStart(sourceFile)
  const masked = maskCommentRanges(file.content, start, end)
  return masked
    .split('\n')
    .slice(1, -1)
    .some((line) => line.trim() === '')
}

function scanSpacing(file, sourceFile, violations) {
  const statements = sourceFile.statements
  for (let index = 1; index < statements.length; index += 1) {
    const previous = statements[index - 1]
    const current = statements[index]
    if (ts.isImportDeclaration(previous) && ts.isImportDeclaration(current)) continue
    if (hasSeparatingBlankLine(file, previous, current, sourceFile)) continue
    violations.push({
      path: file.path,
      line: lineNumber(sourceFile, current.getStart(sourceFile)),
      rule: 'module-spacing'
    })
  }
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

function runCli() {
  runCheck({ roots: TSX_ROOTS, extensions: ['.tsx'] }, scanTsxStyle)
}

if (isDirectRun(import.meta.url)) runCli()
