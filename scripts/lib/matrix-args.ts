import { resolve } from 'node:path'

export interface MatrixArgs {
  required: string[]
  optional: string[]
  evidenceDir: string
  gate: string
}

const GATE_PATTERN = /^G0-[A-Z0-9]+$/

export function deriveGate(evidenceDir: string): string {
  return evidenceDir.includes('G0-PSD2LIVE') ? 'G0-PSD2LIVE' : 'G0-RENDER'
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1]
  if (value === undefined || value.length === 0 || value.startsWith('--')) {
    throw new Error(`MATRIX_ARG_MISSING:${flag}`)
  }
  return value
}

function validateGate(value: string): string {
  if (!GATE_PATTERN.test(value)) throw new Error(`MATRIX_GATE_INVALID:${value}`)
  return value
}

export function parseArgs(argv: string[]): MatrixArgs {
  const args: MatrixArgs = {
    required: [],
    optional: [],
    evidenceDir: resolve('docs/plans/evidence/phase0/G0-RENDER'),
    gate: ''
  }
  let explicitGate: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i] as string
    if (flag === '--required' || flag === '--optional') {
      args[flag === '--required' ? 'required' : 'optional'].push(requireValue(argv, i, flag))
      i++
    } else if (flag === '--evidence-dir') {
      args.evidenceDir = resolve(requireValue(argv, i, flag))
      i++
    } else if (flag === '--gate') {
      explicitGate = requireValue(argv, i, flag)
      i++
    } else {
      throw new Error(`MATRIX_ARG_UNKNOWN:${flag}`)
    }
  }
  args.gate = validateGate(explicitGate ?? deriveGate(args.evidenceDir))
  return args
}
