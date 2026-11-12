import { describe, expect, it } from 'vitest'
import { deriveGate, parseArgs } from './matrix-args'

const REQUIRED = '--required'
const MODEL = 'haru=/models/Haru.model3.json'

describe('deriveGate', () => {
  it('labels PSD2LIVE evidence directories', () => {
    expect(deriveGate('/tmp/G0-PSD2LIVE/render')).toBe('G0-PSD2LIVE')
  })

  it('defaults every other evidence directory to G0-RENDER', () => {
    expect(deriveGate('/tmp/G0-RENDER')).toBe('G0-RENDER')
    expect(deriveGate('/tmp/matrix')).toBe('G0-RENDER')
  })
})

describe('parseArgs', () => {
  it('defaults the gate to G0-RENDER', () => {
    expect(parseArgs([REQUIRED, MODEL]).gate).toBe('G0-RENDER')
  })

  it('derives G0-PSD2LIVE from the evidence directory', () => {
    const args = parseArgs([REQUIRED, MODEL, '--evidence-dir', '/tmp/G0-PSD2LIVE/render'])
    expect(args.gate).toBe('G0-PSD2LIVE')
  })

  it('keeps an explicit gate override', () => {
    const args = parseArgs([
      REQUIRED,
      MODEL,
      '--evidence-dir',
      '/tmp/G0-PSD2LIVE/render',
      '--gate',
      'G0-RENDER'
    ])
    expect(args.gate).toBe('G0-RENDER')
  })

  it('lets an explicit gate override an evidence directory parsed later', () => {
    const args = parseArgs(['--gate', 'G0-DATA', '--evidence-dir', '/tmp/G0-PSD2LIVE/render'])
    expect(args.gate).toBe('G0-DATA')
  })

  it('rejects a flag whose value is another flag', () => {
    expect(() => parseArgs([REQUIRED, '--evidence-dir', '/tmp/x'])).toThrow('MATRIX_ARG_MISSING:--required')
    expect(() => parseArgs(['--gate', '--required', MODEL])).toThrow('MATRIX_ARG_MISSING:--gate')
  })

  it('rejects a flag missing its value at the end', () => {
    expect(() => parseArgs([REQUIRED])).toThrow('MATRIX_ARG_MISSING:--required')
    expect(() => parseArgs(['--optional'])).toThrow('MATRIX_ARG_MISSING:--optional')
    expect(() => parseArgs(['--gate'])).toThrow('MATRIX_ARG_MISSING:--gate')
    expect(() => parseArgs(['--evidence-dir'])).toThrow('MATRIX_ARG_MISSING:--evidence-dir')
  })

  it('rejects empty and unknown-shaped gates', () => {
    expect(() => parseArgs(['--gate', ''])).toThrow('MATRIX_ARG_MISSING:--gate')
    expect(() => parseArgs(['--gate', 'psd'])).toThrow('MATRIX_GATE_INVALID:psd')
    expect(() => parseArgs(['--gate', 'G0-psd2live'])).toThrow('MATRIX_GATE_INVALID:G0-psd2live')
    expect(() => parseArgs(['--gate', 'G0-PSD2LIVE.render'])).toThrow(
      'MATRIX_GATE_INVALID:G0-PSD2LIVE.render'
    )
  })

  it('still rejects unknown flags', () => {
    expect(() => parseArgs(['--nope'])).toThrow('MATRIX_ARG_UNKNOWN:--nope')
  })
})
