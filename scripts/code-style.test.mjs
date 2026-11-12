import assert from 'node:assert/strict'
import test from 'node:test'

import { scanCommentViolations } from './check-code-comments.mjs'
import { scanTsxStyle } from './check-tsx-style.mjs'

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
