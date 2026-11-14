import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  PLAYWRIGHT_EVIDENCE_SCHEMA,
  VITEST_EVIDENCE_SCHEMA,
  sanitizePlaywrightReport,
  sanitizeVitestReport
} from './collect-test-evidence.mjs'

const ROOT = '/phase1-root'
const SCRIPT_PATH = fileURLToPath(new URL('./collect-test-evidence.mjs', import.meta.url))
const SECRET_SENTINEL = 'Bearer sk-secret-ark-1234567890'

test('sanitizes Vitest output to relative paths and statuses only', () => {
  const cleaned = sanitizeVitestReport(
    {
      success: false,
      numTotalTests: 2,
      testResults: [
        {
          name: `${ROOT}/apps/server/tests/example.test.ts`,
          status: 'failed',
          message: `${SECRET_SENTINEL} at /Users/alice/private`,
          assertionResults: [
            {
              status: 'passed',
              fullName: `提示词正文 ${SECRET_SENTINEL}`,
              failureMessages: ['/Users/alice/private/output.txt']
            },
            {
              status: 'skipped',
              fullName: '/Users/alice/private/secret.test.ts'
            }
          ]
        }
      ]
    },
    { root: ROOT }
  )

  assert.deepEqual(cleaned, {
    schemaVersion: VITEST_EVIDENCE_SCHEMA,
    success: false,
    testResults: [
      {
        name: 'apps/server/tests/example.test.ts',
        status: 'failed',
        assertionResults: [{ status: 'passed' }, { status: 'non-passing' }]
      }
    ]
  })
  const serialized = JSON.stringify(cleaned)
  assert.equal(serialized.includes('/Users/'), false)
  assert.equal(serialized.includes('sk-secret'), false)
  assert.equal(serialized.includes('提示词正文'), false)
})

test('sanitizes Playwright output while preserving retries and file grouping', () => {
  const cleaned = sanitizePlaywrightReport(
    {
      config: { rootDir: '/Users/alice/private/project' },
      errors: [{ message: `${SECRET_SENTINEL} /Users/alice/private` }],
      suites: [
        {
          title: 'root',
          file: `${ROOT}/e2e`,
          suites: [
            {
              title: 'secret',
              file: `${ROOT}/e2e/example.spec.ts`,
              suites: [],
              specs: [
                {
                  title: `提示词正文 ${SECRET_SENTINEL}`,
                  file: `${ROOT}/e2e/example.spec.ts`,
                  line: 1,
                  column: 1,
                  tests: [
                    {
                      title: 'retried',
                      status: 'expected',
                      results: [
                        { status: 'failed', error: { message: '/Users/alice/private' } },
                        { status: 'passed', duration: 100 }
                      ]
                    },
                    {
                      title: 'skipped',
                      status: 'skipped',
                      results: [{ status: 'skipped' }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    { root: ROOT }
  )

  assert.deepEqual(cleaned, {
    schemaVersion: PLAYWRIGHT_EVIDENCE_SCHEMA,
    errors: [{ code: 'REPORTER_ERROR' }],
    suites: [
      {
        title: '',
        file: 'e2e/example.spec.ts',
        suites: [],
        specs: [
          {
            title: '',
            file: 'e2e/example.spec.ts',
            tests: [
              {
                title: '',
                results: [{ status: 'non-passing' }, { status: 'passed' }]
              },
              {
                title: '',
                results: [{ status: 'non-passing' }]
              }
            ]
          }
        ]
      }
    ]
  })
  const serialized = JSON.stringify(cleaned)
  assert.equal(serialized.includes('/Users/'), false)
  assert.equal(serialized.includes('sk-secret'), false)
  assert.equal(serialized.includes('提示词正文'), false)
  assert.equal(serialized.includes('rootDir'), false)
})

test('rejects report paths outside the repository root', () => {
  assert.throws(
    () =>
      sanitizeVitestReport(
        {
          testResults: [
            {
              name: '/Users/alice/private/example.test.ts',
              assertionResults: [{ status: 'passed' }]
            }
          ]
        },
        { root: ROOT }
      ),
    /outside the repository root/
  )
  assert.throws(
    () =>
      sanitizePlaywrightReport(
        {
          suites: [
            {
              file: '/Users/alice/private',
              specs: [
                {
                  file: '/Users/alice/private/example.spec.ts',
                  tests: []
                }
              ]
            }
          ]
        },
        { root: ROOT }
      ),
    /outside the repository root/
  )
})

test('rejects malformed reports instead of writing partial evidence', () => {
  assert.throws(() => sanitizeVitestReport({ testResults: 'not-an-array' }, { root: ROOT }), /malformed/)
  assert.throws(
    () =>
      sanitizePlaywrightReport(
        {
          suites: [{ specs: [{ file: `${ROOT}/e2e/a.spec.ts`, tests: 'not-an-array' }] }]
        },
        { root: ROOT }
      ),
    /malformed/
  )
})

test('CLI writes a private sanitized JSON file and never echoes raw content', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'agent2live-evidence-test-'))
  try {
    writeFileSync(
      join(tempRoot, 'raw.json'),
      JSON.stringify({
        success: true,
        testResults: [
          {
            name: 'apps/server/tests/a.test.ts',
            status: 'passed',
            assertionResults: [{ status: 'passed', fullName: SECRET_SENTINEL }]
          }
        ]
      })
    )
    const result = spawnSync(process.execPath, [SCRIPT_PATH, 'vitest', 'raw.json', 'out/vitest.json'], {
      cwd: tempRoot,
      encoding: 'utf8'
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.includes('sk-secret'), false)
    assert.equal(result.stderr.includes('sk-secret'), false)
    const outputPath = join(tempRoot, 'out/vitest.json')
    const parsed = JSON.parse(readFileSync(outputPath, 'utf8'))
    assert.equal(parsed.schemaVersion, VITEST_EVIDENCE_SCHEMA)
    assert.equal(JSON.stringify(parsed).includes('sk-secret'), false)
    assert.equal(statSync(outputPath).mode & 0o777, 0o600)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('CLI uses exit 1 for malformed input and exit 2 for usage errors', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'agent2live-evidence-test-'))
  try {
    writeFileSync(join(tempRoot, 'bad.json'), '{"suites":"bad"}')
    const malformed = spawnSync(
      process.execPath,
      [SCRIPT_PATH, 'playwright', 'bad.json', 'out/playwright.json'],
      { cwd: tempRoot, encoding: 'utf8' }
    )
    assert.equal(malformed.status, 1)
    assert.equal(existsSync(join(tempRoot, 'out/playwright.json')), false)

    const usage = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: tempRoot,
      encoding: 'utf8'
    })
    assert.equal(usage.status, 2)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
