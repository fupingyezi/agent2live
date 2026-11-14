#!/usr/bin/env node
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const VITEST_EVIDENCE_SCHEMA = 'vitest-evidence/1'
export const PLAYWRIGHT_EVIDENCE_SCHEMA = 'playwright-evidence/1'

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeRepoPath(rawPath, root) {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    throw new Error('test path is malformed')
  }
  let candidate = rawPath.trim()
  if (candidate.startsWith('file://')) {
    try {
      candidate = fileURLToPath(candidate)
    } catch {
      throw new Error('test path is malformed')
    }
  }
  candidate = candidate.replaceAll('\\', '/')
  const absolute = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate)
  const relativePath = relative(root, absolute)
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error('test path is outside the repository root')
  }
  return relativePath.split(sep).join('/')
}

function normalizeVitestStatus(status) {
  if (status === 'passed') return 'passed'
  if (status === 'failed') return 'failed'
  return 'non-passing'
}

export function sanitizeVitestReport(report, { root = process.cwd() } = {}) {
  if (!isPlainObject(report) || !Array.isArray(report.testResults)) {
    throw new Error('Vitest report is malformed')
  }
  const resolvedRoot = resolve(root)
  return {
    schemaVersion: VITEST_EVIDENCE_SCHEMA,
    success: report.success !== false,
    testResults: report.testResults.map((result) => {
      if (!isPlainObject(result) || !Array.isArray(result.assertionResults)) {
        throw new Error('Vitest report is malformed')
      }
      return {
        name: normalizeRepoPath(result.name, resolvedRoot),
        status: result.status === 'failed' ? 'failed' : 'not-failed',
        assertionResults: result.assertionResults.map((assertion) => {
          if (!isPlainObject(assertion)) {
            throw new Error('Vitest report is malformed')
          }
          return { status: normalizeVitestStatus(assertion.status) }
        })
      }
    })
  }
}

function normalizePlaywrightStatus(status) {
  return status === 'passed' ? 'passed' : 'non-passing'
}

export function sanitizePlaywrightReport(report, { root = process.cwd() } = {}) {
  if (!isPlainObject(report) || !Array.isArray(report.suites)) {
    throw new Error('Playwright report is malformed')
  }
  if (report.errors !== undefined && !Array.isArray(report.errors)) {
    throw new Error('Playwright report is malformed')
  }
  const resolvedRoot = resolve(root)
  const testsByFile = new Map()

  const walk = (suites, inheritedFile) => {
    if (!Array.isArray(suites)) {
      throw new Error('Playwright report is malformed')
    }
    for (const suite of suites) {
      if (!isPlainObject(suite)) {
        throw new Error('Playwright report is malformed')
      }
      const suiteFile = typeof suite.file === 'string' ? suite.file : inheritedFile
      if (suite.specs !== undefined && !Array.isArray(suite.specs)) {
        throw new Error('Playwright report is malformed')
      }
      for (const spec of suite.specs ?? []) {
        if (!isPlainObject(spec) || !Array.isArray(spec.tests)) {
          throw new Error('Playwright report is malformed')
        }
        const file = normalizeRepoPath(typeof spec.file === 'string' ? spec.file : suiteFile, resolvedRoot)
        const tests = testsByFile.get(file) ?? []
        for (const playwrightTest of spec.tests) {
          if (!isPlainObject(playwrightTest) || !Array.isArray(playwrightTest.results)) {
            throw new Error('Playwright report is malformed')
          }
          tests.push({
            title: '',
            results: playwrightTest.results.map((result) => {
              if (!isPlainObject(result)) {
                throw new Error('Playwright report is malformed')
              }
              return { status: normalizePlaywrightStatus(result.status) }
            })
          })
        }
        testsByFile.set(file, tests)
      }
      if (suite.suites !== undefined && !Array.isArray(suite.suites)) {
        throw new Error('Playwright report is malformed')
      }
      walk(suite.suites ?? [], suiteFile)
    }
  }

  walk(report.suites, null)

  return {
    schemaVersion: PLAYWRIGHT_EVIDENCE_SCHEMA,
    errors: Array.from({ length: Array.isArray(report.errors) ? report.errors.length : 0 }, () => ({
      code: 'REPORTER_ERROR'
    })),
    suites: [...testsByFile.entries()].map(([file, tests]) => ({
      title: '',
      file,
      suites: [],
      specs: [
        {
          title: '',
          file,
          tests
        }
      ]
    }))
  }
}

function writeSanitizedEvidence(mode, inputPath, outputPath, root) {
  const input = resolve(root, inputPath)
  const output = resolve(root, outputPath)
  if (input === output) throw new Error('input and output must differ')
  const relativeOutput = relative(root, output)
  if (
    relativeOutput === '' ||
    relativeOutput === '..' ||
    relativeOutput.startsWith(`..${sep}`) ||
    isAbsolute(relativeOutput)
  ) {
    throw new Error('output path is outside the repository root')
  }
  const raw = JSON.parse(readFileSync(input, 'utf8'))
  const sanitized =
    mode === 'vitest' ? sanitizeVitestReport(raw, { root }) : sanitizePlaywrightReport(raw, { root })
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(sanitized, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  chmodSync(output, 0o600)
}

const USAGE = [
  'Usage: node scripts/collect-test-evidence.mjs <vitest|playwright> <input-json> <output-json>',
  ''
].join('\n')

function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    process.stdout.write(USAGE)
    return 0
  }
  if (argv.length !== 3 || !['vitest', 'playwright'].includes(argv[0])) {
    process.stderr.write(USAGE)
    return 2
  }
  try {
    writeSanitizedEvidence(argv[0], argv[1], argv[2], process.cwd())
    return 0
  } catch {
    process.stderr.write('test evidence: failed to sanitize report\n')
    return 1
  }
}

const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isEntryPoint) {
  process.exitCode = main()
}
