import {
  promptBlockSchema,
  promptSpecCoreSchema,
  type PromptBlock,
  type PromptOperation,
  type PromptSpecV2
} from '@agent2live/contracts'
import { AppError } from '../errors'
import { specCoreOf } from './compile'

export interface ApplyOptions {
  source: 'ai-suggestion'
  respectLockAll?: boolean
}

function cloneBlock(block: PromptBlock): PromptBlock {
  return {
    ...block,
    evidence: block.evidence.map((entry) =>
      entry.region ? { ...entry, region: { ...entry.region } } : { ...entry }
    ),
    requirementRefs: [...block.requirementRefs],
    materialRefs: [...block.materialRefs]
  }
}

function blockMaps(spec: PromptSpecV2): {
  positive: Map<string, PromptBlock>
  negative: Map<string, PromptBlock>
} {
  return {
    positive: new Map(spec.blocks.map((block) => [block.id, block])),
    negative: new Map(spec.negativeBlocks.map((block) => [block.id, block]))
  }
}

function findTarget(
  positive: Map<string, PromptBlock>,
  negative: Map<string, PromptBlock>,
  id: string
): PromptBlock {
  const block = positive.get(id) ?? negative.get(id)
  if (!block) throw new AppError('PROMPT_OPERATION_STALE', { blockId: id })
  return block
}

function assertUnlocked(spec: PromptSpecV2, block: PromptBlock, respectLockAll: boolean): void {
  if ((respectLockAll && spec.lockAll) || block.locked) {
    throw new AppError('PROMPT_BLOCK_LOCKED', { blockId: block.id })
  }
}

function assertValidResult(next: PromptSpecV2): void {
  try {
    promptSpecCoreSchema.parse(specCoreOf(next))
  } catch {
    throw new AppError('PROMPT_OPERATION_INVALID', { reason: 'operations_produce_invalid_spec' })
  }
}

export function applyPromptOperations(
  spec: PromptSpecV2,
  operations: PromptOperation[],
  options: ApplyOptions
): PromptSpecV2 {
  promptSpecCoreSchema.parse(specCoreOf(spec))
  const next: PromptSpecV2 = {
    ...spec,
    blocks: spec.blocks.map(cloneBlock),
    negativeBlocks: spec.negativeBlocks.map(cloneBlock)
  }
  const maps = blockMaps(next)
  const added = new Set<string>()
  const respectLockAll = options.respectLockAll ?? true
  for (const operation of operations) {
    if (operation.op === 'add') {
      if (
        added.has(operation.block.id) ||
        maps.positive.has(operation.block.id) ||
        maps.negative.has(operation.block.id)
      ) {
        throw new AppError('PROMPT_OPERATION_INVALID', { reason: 'duplicate_block_id' })
      }
      if (respectLockAll && next.lockAll) {
        throw new AppError('PROMPT_BLOCK_LOCKED', { blockId: operation.block.id })
      }
      const block = promptBlockSchema.parse({ ...operation.block, source: options.source })
      added.add(block.id)
      if (block.category === 'negative') {
        next.negativeBlocks.push(block)
        maps.negative.set(block.id, block)
      } else {
        next.blocks.push(block)
        maps.positive.set(block.id, block)
      }
      continue
    }
    const target = findTarget(maps.positive, maps.negative, operation.blockId)
    assertUnlocked(next, target, respectLockAll)
    if (operation.op === 'replace') {
      if (target.text !== operation.before) {
        throw new AppError('PROMPT_OPERATION_STALE', { blockId: target.id })
      }
      target.text = operation.after
    } else if (operation.op === 'setWeight') {
      if (target.weight !== operation.before) {
        throw new AppError('PROMPT_OPERATION_STALE', { blockId: target.id })
      }
      target.weight = operation.after
    } else if (operation.op === 'remove') {
      if (target.text !== operation.before) {
        throw new AppError('PROMPT_OPERATION_STALE', { blockId: target.id })
      }
      next.blocks = next.blocks.filter((block) => block.id !== target.id)
      next.negativeBlocks = next.negativeBlocks.filter((block) => block.id !== target.id)
      maps.positive.delete(target.id)
      maps.negative.delete(target.id)
    }
  }
  assertValidResult(next)
  return next
}
