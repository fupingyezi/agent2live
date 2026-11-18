import AxeBuilder from '@axe-core/playwright'
import type { ElectronApplication, Page } from '@playwright/test'
import { chmodSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { scanTokenViolations, type TokenViolation } from '../../scripts/token-lint.mjs'
import { phase1EvidencePath } from './evidence'

export interface AxeViolationSummary {
  id: string
  impact: string | null
  help: string
  nodes: number
}

export interface AxePageResult {
  name: string
  status: 'pass' | 'fail'
  violations: AxeViolationSummary[]
}

export interface TokenLintResult {
  schemaVersion: 'ui-token-lint/1'
  status: 'pass' | 'fail'
  generatedAt: string
  scannedFiles: number
  violations: TokenViolation[]
  rules: string[]
}

export const UI_BASELINE = Object.freeze({ width: 1440, height: 900 })
export const TOKEN_RULES = Object.freeze(['raw-color', 'arbitrary-radius', 'deep-import'])

export async function resizeToBaseline(app: ElectronApplication, page: Page): Promise<void> {
  // The pet window is non-resizable and may come first in getAllWindows(),
  // so resolve the studio window by URL instead of picking the first window.
  const targetUrl = page.url().split('#')[0]
  await app.evaluate(
    ({ BrowserWindow }, options) => {
      const window =
        BrowserWindow.getAllWindows().find(
          (candidate) => candidate.webContents.getURL().split('#')[0] === options.url
        ) ?? BrowserWindow.getAllWindows()[0]
      if (window) window.setContentSize(options.width, options.height)
    },
    { url: targetUrl, ...UI_BASELINE }
  )
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForFunction(
    (size) => window.innerWidth === size.width && window.innerHeight === size.height,
    { ...UI_BASELINE }
  )
  await page.evaluate(() => document.fonts.ready)
}

export async function scanAxe(page: Page, name: string): Promise<AxePageResult> {
  // Electron cannot create the secondary CDP target axe uses by default,
  // so run in legacy mode which analyzes the page in place.
  const result = await new AxeBuilder({ page })
    .setLegacyMode(true)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return {
    name,
    status: result.violations.length === 0 ? 'pass' : 'fail',
    violations: result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? null,
      help: violation.help,
      nodes: violation.nodes.length
    }))
  }
}

export async function captureVisual(
  app: ElectronApplication,
  page: Page,
  name: string,
  prepare?: () => Promise<void>
): Promise<string> {
  await resizeToBaseline(app, page)
  if (prepare) await prepare()
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
  )
  const target = phase1EvidencePath('ui', 'visual', `${name}-1440x900.png`)
  mkdirSync(dirname(target), { recursive: true })
  await page.screenshot({ path: target, animations: 'disabled', scale: 'css' })
  chmodSync(target, 0o600)
  if (statSync(target).size === 0) {
    throw new Error(`visual baseline ${name} is empty`)
  }
  return target
}

function listLintFiles(directory: string, files: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) {
      listLintFiles(absolute, files)
    } else if (
      entry.isFile() &&
      !entry.name.endsWith('.test.tsx') &&
      !entry.name.endsWith('.spec.tsx') &&
      (entry.name.endsWith('.css') || entry.name.endsWith('.tsx'))
    ) {
      files.push(absolute)
    }
  }
}

export function lintStudioTokens(root: string): TokenLintResult {
  const studioRoot = join(root, 'apps', 'desktop', 'src', 'renderer', 'studio')
  const files: string[] = []
  listLintFiles(studioRoot, files)
  const scanned = files.map((absolute) => ({
    path: relative(root, absolute).split(sep).join('/'),
    content: readFileSync(absolute, 'utf8')
  }))
  const violations = scanTokenViolations(scanned)
  return {
    schemaVersion: 'ui-token-lint/1',
    status: violations.length === 0 ? 'pass' : 'fail',
    generatedAt: new Date().toISOString(),
    scannedFiles: files.length,
    violations,
    rules: [...TOKEN_RULES]
  }
}
