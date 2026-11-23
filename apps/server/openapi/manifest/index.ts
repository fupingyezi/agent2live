import { characterProjectOperations } from './characters'
import { generationOperations } from './generations'
import { promptOperations } from './prompt'
import { systemOperations } from './system'
import type { OperationSpec } from './types'

export const manifest: OperationSpec[] = [
  ...systemOperations,
  ...characterProjectOperations,
  ...promptOperations,
  ...generationOperations
]
