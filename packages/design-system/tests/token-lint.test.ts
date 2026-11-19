import { describe, expect, it } from 'vitest'
import { scanTokenViolations } from '../../../scripts/token-lint.mjs'

function scan(path: string, content: string): ReturnType<typeof scanTokenViolations> {
  return scanTokenViolations([{ path, content }])
}

describe('token lint', () => {
  it('accepts token-only colors and radii', () => {
    expect(
      scan(
        'apps/desktop/src/renderer/studio/app.css',
        '.root { color: var(--a2l-color-text); border-radius: var(--a2l-radius-control); border-radius: 50%; }'
      )
    ).toEqual([])
  })

  it('flags raw colors and arbitrary radii', () => {
    const result = scan(
      'apps/desktop/src/renderer/studio/app.css',
      '.root { color: #fff; background: rgba(0, 0, 0, 0.2); border-radius: 12px; }'
    )
    expect(result.map((violation) => violation.rule)).toEqual(['raw-color', 'raw-color', 'arbitrary-radius'])
  })

  it('scans scss modules for raw colors and arbitrary radii', () => {
    const result = scan(
      'apps/desktop/src/renderer/studio/Page.module.scss',
      '.root { color: #fff; background: rgba(0, 0, 0, 0.2); border-radius: 12px; }'
    )
    expect(result.map((violation) => violation.rule)).toEqual(['raw-color', 'raw-color', 'arbitrary-radius'])
  })

  it('flags hex literals in TSX and deep imports', () => {
    const result = scan(
      'apps/desktop/src/renderer/studio/Page.tsx',
      "const color = '#FFFFFF'\nimport { Button } from '@agent2live/design-system/src'\n"
    )
    expect(result.map((violation) => violation.rule)).toEqual(['raw-color', 'deep-import'])
  })

  it('allows the public styles entry', () => {
    expect(
      scan('apps/desktop/src/renderer/main.tsx', "import '@agent2live/design-system/styles.css'\n")
    ).toEqual([])
  })
})
