import { characterProjectOperations } from './characters'
import { generationOperations } from './generations'
import { promptOperations } from './prompt'
import { resourceOperations } from './resources'
import { systemOperations } from './system'
import type { OperationSpec } from './types'

export const manifest: OperationSpec[] = [
  ...systemOperations,
  ...characterProjectOperations,
  ...promptOperations,
  ...generationOperations,
  ...resourceOperations
]
