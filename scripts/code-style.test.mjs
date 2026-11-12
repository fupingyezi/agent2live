import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { scanCommentViolations } from './check-code-comments.mjs'
import { scanTsxStyle } from './check-tsx-style.mjs'
import { discoverFiles, exitCodeForViolations, reportViolations, runCheck } from './code-style-shared.mjs'

test('rejects a component with an inline props type', () => {
  const source = [
    "import React from 'react'",
    '',
    'export function Card({ title }: { title: string }) {',
    '  return <article>{title}</article>',
    '}'
  ].join('\n')
  assert.deepEqual(scanTsxStyle([{ path: 'Card.tsx', content: source }]), [
    { path: 'Card.tsx', line: 3, rule: 'component-props' }
  ])
})

test('rejects top-level declarations without a separating blank line', () => {
  const source = [
    "import React from 'react'",
    'export interface CardProps { title: string }',
    'export const Card: React.FC<CardProps> = ({ title }) => <article>{title}</article>'
  ].join('\n')
  assert.deepEqual(
    scanTsxStyle([{ path: 'Card.tsx', content: source }]).map((entry) => entry.rule),
    ['module-spacing', 'module-spacing']
  )
})

test('accepts a grouped React.FC component', () => {
  const source = [
    "import React from 'react'",
    '',
    'export interface CardProps { title: string }',
    '',
    'export const Card: React.FC<CardProps> = ({ title }) => {',
    '  return <article>{title}</article>',
    '}'
  ].join('\n')
  assert.deepEqual(scanTsxStyle([{ path: 'Card.tsx', content: source }]), [])
})

test('rejects comments that cite execution context', () => {
  const source = ['// Phase 1 Task 12: keep the token local.', 'const value = 1'].join('\n')
  assert.deepEqual(scanCommentViolations([{ path: 'value.ts', content: source }]), [
    { path: 'value.ts', line: 1, rule: 'comment-context' }
  ])
})

test('accepts comments that explain implementation design', () => {
  const source = ['// Keep the host check before filesystem access.', 'const value = 1'].join('\n')
  assert.deepEqual(scanCommentViolations([{ path: 'value.ts', content: source }]), [])
})

test('allows consecutive import declarations without blank lines', () => {
  const source = [
    "import React from 'react'",
    "import { createRoot } from 'react-dom/client'",
    '',
    'export const App: React.FC = () => <main>hello</main>'
  ].join('\n')
  assert.deepEqual(scanTsxStyle([{ path: 'App.tsx', content: source }]), [])
})

test('allows generic forwardRef and memo signatures to type their props', () => {
  const source = [
    "import React from 'react'",
    '',
    'export interface CardProps {',
    '  title: string',
    '}',
    '',
    'export const Card = React.forwardRef<HTMLDivElement, CardProps>(({ title }, ref) => (',
    '  <div ref={ref}>{title}</div>',
    '))',
    '',
    'export const MemoCard = React.memo<CardProps>(({ title }) => <div>{title}</div>)'
  ].join('\n')
  assert.deepEqual(scanTsxStyle([{ path: 'Card.tsx', content: source }]), [])
})

test('rejects a typed render function without a props generic', () => {
  const source = [
    "import React from 'react'",
    '',
    'export interface CardProps { title: string }',
    '',
    'export const Card = React.memo(({ title }: CardProps) => <div>{title}</div>)'
  ].join('\n')
  assert.deepEqual(scanTsxStyle([{ path: 'Card.tsx', content: source }]), [
    { path: 'Card.tsx', line: 5, rule: 'component-props' }
  ])
})

test('sorts TSX violations deterministically across files', () => {
  const files = [
    {
      path: 'b/B.tsx',
      content: [
        "import React from 'react'",
        'export function B({ title }: { title: string }) {',
        '  return <div>{title}</div>',
        '}'
      ].join('\n')
    },
    {
      path: 'a/A.tsx',
      content: [
        "import React from 'react'",
        'export interface AProps { title: string }',
        'export const A: React.FC<AProps> = ({ title }) => <div>{title}</div>'
      ].join('\n')
    }
  ]
  const expected = [
    { path: 'a/A.tsx', line: 2, rule: 'module-spacing' },
    { path: 'a/A.tsx', line: 3, rule: 'module-spacing' },
    { path: 'b/B.tsx', line: 2, rule: 'component-props' },
    { path: 'b/B.tsx', line: 2, rule: 'module-spacing' }
  ]
  assert.deepEqual(scanTsxStyle(files), expected)
  assert.deepEqual(scanTsxStyle([...files].reverse()), expected)
  assert.deepEqual(scanTsxStyle(files), scanTsxStyle(files))
})

test('ignores banned phrases inside string, template, regex, and JSX literals', () => {
  const source = [
    "const message = 'Phase 1 Task 12 lives in docs/'",
    'const template = `ADR 9 执行上下文`',
    'const pattern = /Task 7 docs\\//',
    'const element = <p>Task 9 docs/</p>'
  ].join('\n')
  assert.deepEqual(scanCommentViolations([{ path: 'value.tsx', content: source }]), [])
})

test('rejects block comments that cite tasks or docs paths', () => {
  const source = [
    '/* Task 12 keeps this value local. */',
    'const value = 1',
    '',
    '/* See docs/architecture for the rationale. */',
    'const other = 2'
  ].join('\n')
  assert.deepEqual(scanCommentViolations([{ path: 'value.ts', content: source }]), [
    { path: 'value.ts', line: 1, rule: 'comment-context' },
    { path: 'value.ts', line: 4, rule: 'comment-context' }
  ])
})

test('rejects a plain uppercase const component with an inline props type', () => {
  const source = [
    "import React from 'react'",
    '',
    'export const Card = ({ title }: { title: string }) => <div>{title}</div>',
    '',
    'export const Panel = function ({ label }: { label: string }) {',
    '  return <div>{label}</div>',
    '}'
  ].join('\n')
  assert.deepEqual(scanTsxStyle([{ path: 'Card.tsx', content: source }]), [
    { path: 'Card.tsx', line: 3, rule: 'component-props' },
    { path: 'Card.tsx', line: 5, rule: 'component-props' }
  ])
})

test('rejects statements separated only by a block comment with an internal blank line', () => {
  const source = [
    "import React from 'react'",
    '',
    'export const first = 1',
    '/* note',
    '',
    '   continued */',
    'export const second = 2'
  ].join('\n')
  assert.deepEqual(scanTsxStyle([{ path: 'values.tsx', content: source }]), [
    { path: 'values.tsx', line: 7, rule: 'module-spacing' }
  ])
})

test('accepts a real blank line outside a block comment between statements', () => {
  const source = [
    "import React from 'react'",
    '',
    'export const first = 1',
    '',
    '/* note',
    '',
    '   continued */',
    'export const second = 2'
  ].join('\n')
  assert.deepEqual(scanTsxStyle([{ path: 'values.tsx', content: source }]), [])
})

test('rejects lowercase context phrases in real comments', () => {
  const source = [
    '// phase 1',
    'const a = 1',
    '',
    '// task 12',
    'const b = 2',
    '',
    '// adr 9',
    'const c = 3',
    '',
    '// see docs/architecture for details',
    'const d = 4',
    '',
    '// 按计划',
    'const e = 5',
    '',
    '// 按用户要求',
    'const f = 6',
    '',
    '// 执行上下文',
    'const g = 7'
  ].join('\n')
  assert.deepEqual(scanCommentViolations([{ path: 'value.ts', content: source }]), [
    { path: 'value.ts', line: 1, rule: 'comment-context' },
    { path: 'value.ts', line: 4, rule: 'comment-context' },
    { path: 'value.ts', line: 7, rule: 'comment-context' },
    { path: 'value.ts', line: 10, rule: 'comment-context' },
    { path: 'value.ts', line: 13, rule: 'comment-context' },
    { path: 'value.ts', line: 16, rule: 'comment-context' },
    { path: 'value.ts', line: 19, rule: 'comment-context' }
  ])
})

test('fails closed when a configured root is missing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'code-style-'))
  try {
    assert.throws(
      () => discoverFiles({ baseDir: directory, roots: ['missing'], extensions: ['.ts'] }),
      /CODE_STYLE_ROOT_MISSING:missing/
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('fails closed when discovery finds no files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'code-style-'))
  try {
    mkdirSync(join(directory, 'empty'))
    assert.throws(
      () => discoverFiles({ baseDir: directory, roots: ['empty'], extensions: ['.ts'] }),
      /CODE_STYLE_NO_FILES/
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('discovers matching files, skips excluded directories, and includes base files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'code-style-'))
  try {
    mkdirSync(join(directory, 'src'))
    mkdirSync(join(directory, 'src', 'node_modules'))
    writeFileSync(join(directory, 'src', 'keep.ts'), '')
    writeFileSync(join(directory, 'src', 'skip.md'), '')
    writeFileSync(join(directory, 'src', 'node_modules', 'skip.ts'), '')
    writeFileSync(join(directory, 'root.tsx'), '')
    const files = discoverFiles({
      baseDir: directory,
      roots: ['src'],
      extensions: ['.ts'],
      baseFileExtensions: ['.tsx']
    })
    assert.deepEqual(files, [join(directory, 'root.tsx'), join(directory, 'src', 'keep.ts')])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('runCheck resolves discovery and reported paths against a custom baseDir', () => {
  const directory = mkdtempSync(join(tmpdir(), 'code-style-'))
  const lines = []
  const originalLog = console.log
  const originalExitCode = process.exitCode
  try {
    mkdirSync(join(directory, 'src'))
    writeFileSync(
      join(directory, 'src', 'Card.tsx'),
      [
        "import React from 'react'",
        '',
        'export function Card({ title }: { title: string }) {',
        '  return <article>{title}</article>',
        '}'
      ].join('\n')
    )
    console.log = (line) => lines.push(line)
    runCheck({ baseDir: directory, roots: ['src'], extensions: ['.tsx'] }, scanTsxStyle)
    assert.equal(process.exitCode, 1)
    assert.deepEqual(lines, ['src/Card.tsx:3 component-props', '1 violation(s)'])
  } finally {
    console.log = originalLog
    process.exitCode = originalExitCode
    rmSync(directory, { recursive: true, force: true })
  }
})

test('exitCodeForViolations reports failure only when a violation exists', () => {
  assert.equal(exitCodeForViolations([]), 0)
  assert.equal(exitCodeForViolations([{ path: 'a.ts', line: 1, rule: 'comment-context' }]), 1)
})

test('reportViolations prints each violation followed by the count', () => {
  const lines = []
  const code = reportViolations([{ path: 'a.ts', line: 1, rule: 'comment-context' }], (line) =>
    lines.push(line)
  )
  assert.equal(code, 1)
  assert.deepEqual(lines, ['a.ts:1 comment-context', '1 violation(s)'])
  assert.deepEqual(
    (() => {
      const empty = []
      const emptyCode = reportViolations([], (line) => empty.push(line))
      return [emptyCode, empty]
    })(),
    [0, ['0 violation(s)']]
  )
})

test('sorts comment violations deterministically across files', () => {
  const files = [
    { path: 'z.ts', content: ['// Phase 1', 'const a = 1'].join('\n') },
    { path: 'a.ts', content: ['// Task 2 docs/', 'const b = 2', '', '// ADR 9'].join('\n') }
  ]
  const expected = [
    { path: 'a.ts', line: 1, rule: 'comment-context' },
    { path: 'a.ts', line: 4, rule: 'comment-context' },
    { path: 'z.ts', line: 1, rule: 'comment-context' }
  ]
  assert.deepEqual(scanCommentViolations(files), expected)
  assert.deepEqual(scanCommentViolations([...files].reverse()), expected)
  assert.deepEqual(scanCommentViolations(files), scanCommentViolations(files))
})
