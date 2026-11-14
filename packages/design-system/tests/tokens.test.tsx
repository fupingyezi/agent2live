import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { colorTokens, radiusTokens, spacingTokens } from '../src/tokens'

const moduleUrl = import.meta.url

const css = readFileSync(new URL('../src/styles/tokens.css', moduleUrl), 'utf8')

describe('design tokens', () => {
  it('locks the Ardot baseline colors', () => {
    expect(colorTokens.appBg).toBe('#F8FAF9')
    expect(colorTokens.surface).toBe('#FFFFFF')
    expect(colorTokens.accent).toBe('#3FB0A0')
    expect(colorTokens.accentStrong).toBe('#2E9183')
    expect(colorTokens.text).toBe('#252A32')
    expect(colorTokens.textMuted).toBe('#A8AEB8')
    expect(colorTokens.border).toBe('#E7ECEA')
    expect(colorTokens.warning).toBe('#B07C33')
    expect(colorTokens.danger).toBe('#A85468')
  })

  it('keeps CSS token values in sync with TypeScript', () => {
    // Prettier lowercases hex values in CSS, so compare without case.
    const normalizedCss = css.toLowerCase()
    for (const [name, value] of Object.entries(colorTokens)) {
      expect(normalizedCss).toContain(
        `--a2l-color-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}: ${value.toLowerCase()};`
      )
    }
    for (const [name, value] of Object.entries(spacingTokens)) {
      expect(normalizedCss).toContain(`--a2l-space-${name}: ${value};`)
    }
    expect(radiusTokens.control).toBe('11px')
  })

  it('defines the local font stack and reduced-motion reset', () => {
    // Prettier normalizes font-family quotes to single quotes.
    expect(css).toContain("--a2l-font-sans: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;")
    const reset = readFileSync(new URL('../src/styles/reset.css', moduleUrl), 'utf8')
    expect(reset).toContain('prefers-reduced-motion: reduce')
    expect(reset).toContain('outline: 2px solid var(--a2l-color-focus)')
  })
})
