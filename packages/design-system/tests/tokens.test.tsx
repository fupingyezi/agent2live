import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { colorTokens, motionTokens, radiusTokens, spacingTokens } from '../src/tokens'

const moduleUrl = import.meta.url

const css = readFileSync(new URL('../src/styles/tokens.css', moduleUrl), 'utf8')

function cssName(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

describe('design tokens', () => {
  it('locks the Ardot baseline colors', () => {
    expect(colorTokens.appBg).toBe('#F8FAF9')
    expect(colorTokens.surface).toBe('#FFFFFF')
    expect(colorTokens.accent).toBe('#1F826F')
    expect(colorTokens.accentStrong).toBe('#18695C')
    expect(colorTokens.text).toBe('#252A32')
    expect(colorTokens.textMuted).toBe('#626C78')
    expect(colorTokens.border).toBe('#E7ECEA')
    expect(colorTokens.warning).toBe('#8F6423')
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
    for (const [name, value] of Object.entries(radiusTokens)) {
      expect(normalizedCss).toContain(`--a2l-radius-${cssName(name)}: ${value};`)
    }
    for (const [name, value] of Object.entries(motionTokens)) {
      const tokenName = name === 'easeStandard' ? 'ease-standard' : `motion-${cssName(name)}`
      expect(normalizedCss).toContain(`--a2l-${tokenName}: ${value.toLowerCase()};`)
    }
    expect(radiusTokens.control).toBe('11px')
  })

  it('keeps focus and control boundaries above 3:1 contrast', () => {
    const luminance = (hex: string): number => {
      const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
      const [r, g, b] = channels.map((channel) =>
        channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      ) as [number, number, number]
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const contrast = (foreground: string, background: string): number => {
      const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
      return (light! + 0.05) / (dark! + 0.05)
    }
    expect(contrast(colorTokens.focus, colorTokens.surface)).toBeGreaterThanOrEqual(3)
    expect(contrast(colorTokens.scrollbarThumb, colorTokens.appBg)).toBeGreaterThanOrEqual(3)
  })

  it('defines the local font stack and reduced-motion reset', () => {
    // Prettier normalizes font-family quotes to single quotes.
    expect(css).toContain("--a2l-font-sans: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;")
    const reset = readFileSync(new URL('../src/styles/reset.css', moduleUrl), 'utf8')
    expect(reset).toContain('prefers-reduced-motion: reduce')
    expect(reset).toContain('outline: 2px solid var(--a2l-color-focus)')
  })
})
