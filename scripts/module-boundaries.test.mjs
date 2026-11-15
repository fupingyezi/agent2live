import assert from 'node:assert/strict'
import test from 'node:test'

import { scanModuleBoundaries } from './check-module-boundaries.mjs'

test('rejects wildcard exports from a public component barrel', () => {
  const source = "export * from './Button'"

  assert.deepEqual(
    scanModuleBoundaries([
      { path: 'apps/desktop/src/renderer/studio/components/index.ts', content: source }
    ]).map(({ rule }) => rule),
    ['barrel-export-star']
  )
})

test('rejects an undocumented public component export', () => {
  const source = "export { Button } from './Button'"

  assert.deepEqual(
    scanModuleBoundaries([
      { path: 'apps/desktop/src/renderer/studio/components/index.ts', content: source }
    ]).map(({ rule }) => rule),
    ['barrel-missing-jsdoc']
  )
})

test('accepts a documented public component export', () => {
  const source = ['/** 提交或取消当前操作。 */', "export { Button } from './Button'"].join('\n')

  assert.deepEqual(
    scanModuleBoundaries([{ path: 'apps/desktop/src/renderer/studio/components/index.ts', content: source }]),
    []
  )
})

test('rejects deep imports that bypass a public module barrel', () => {
  const source = "import { Button } from '@studio/components/Button'"

  assert.deepEqual(
    scanModuleBoundaries([
      { path: 'apps/desktop/src/renderer/studio/routes/ExamplePage.tsx', content: source }
    ]).map(({ rule }) => rule),
    ['barrel-deep-import']
  )
})

test('rejects renderer imports from Electron main or preload', () => {
  const source = "import { mountModel } from '@renderer/shared'"

  assert.deepEqual(
    scanModuleBoundaries([{ path: 'apps/desktop/src/preload/index.ts', content: source }]).map(
      ({ rule }) => rule
    ),
    ['process-boundary']
  )
})

test('rejects relative renderer imports from Electron preload', () => {
  const source = "import { mountModel } from '../renderer/shared/live2d-stage'"

  assert.deepEqual(
    scanModuleBoundaries([{ path: 'apps/desktop/src/preload/index.ts', content: source }]).map(
      ({ rule }) => rule
    ),
    ['process-boundary']
  )
})

test('rejects relative imports that cross a Studio module boundary', () => {
  const source = "import { StudioError } from '../components/StudioError'"

  assert.deepEqual(
    scanModuleBoundaries([
      { path: 'apps/desktop/src/renderer/studio/routes/ExamplePage.tsx', content: source }
    ]).map(({ rule }) => rule),
    ['barrel-relative-import']
  )
})
