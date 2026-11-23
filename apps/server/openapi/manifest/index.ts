import { characterProjectOperations } from './characters'
import { promptOperations } from './prompt'
import { systemOperations } from './system'
import type { OperationSpec } from './types'

export const manifest: OperationSpec[] = [
  ...systemOperations,
  ...characterProjectOperations,
  ...promptOperations
]
