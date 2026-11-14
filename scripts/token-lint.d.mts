export type TokenLintRule = 'raw-color' | 'arbitrary-radius' | 'deep-import'

export interface TokenViolation {
  path: string
  line: number
  rule: TokenLintRule
  text: string
}

export function scanTokenViolations(files: Array<{ path: string; content: string }>): TokenViolation[]
