import { describe, expect, it } from 'vitest'
import { isAllowedProbeCommand } from './lib/approval'

const allowed = new Set(['printf agent2live-claude-probe', 'sleep 30'])

describe('Claude probe approval allowlist', () => {
  it('allows only exact harmless commands', () => {
    expect(isAllowedProbeCommand('printf agent2live-claude-probe', allowed)).toBe(true)
    expect(isAllowedProbeCommand('sleep 30', allowed)).toBe(true)
  })

  it('denies compound and lookalike commands', () => {
    expect(isAllowedProbeCommand('sleep 30 && rm -rf /tmp/x', allowed)).toBe(false)
    expect(isAllowedProbeCommand('echo sleep 30', allowed)).toBe(false)
    expect(isAllowedProbeCommand('printf agent2live-claude-probe\necho bad', allowed)).toBe(false)
  })
})
