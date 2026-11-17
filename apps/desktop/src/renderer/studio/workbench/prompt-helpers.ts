import { promptMaterialRefSchema, promptSpecSchema } from '@agent2live/contracts/prompt'
import type { PromptBlock, PromptMaterialRef, PromptSpecV2 } from '@agent2live/contracts'

const CORE_KEYS = [
  'schemaVersion',
  'fullPrompt',
  'lockAll',
  'sourceRequirements',
  'materialRefs',
  'blocks',
  'negativeBlocks',
  'constraints'
] as const

export function toCoreSpec(spec: PromptSpecV2): PromptSpecV2 {
  const source = structuredClone(spec) as unknown as Record<string, unknown>
  const core: Record<string, unknown> = {}
  for (const key of CORE_KEYS) core[key] = source[key]
  return promptSpecSchema.parse(core)
}

export function validatePromptForSave(spec: PromptSpecV2): string | null {
  const parsed = promptSpecSchema.safeParse(spec)
  if (parsed.success) return null
  const issue = parsed.error.issues[0]
  if (!issue) return '提示词格式无效'
  return `${issue.path.join('.')}: ${issue.message}`
}

export function uncoveredRequirementIds(spec: PromptSpecV2): string[] {
  const positive = new Set(spec.blocks.flatMap((block) => block.requirementRefs))
  const negative = new Set(spec.negativeBlocks.flatMap((block) => block.requirementRefs))
  return spec.sourceRequirements
    .filter((requirement) =>
      requirement.strength === 'must'
        ? !positive.has(requirement.id)
        : requirement.strength === 'avoid'
          ? !negative.has(requirement.id)
          : false
    )
    .map((requirement) => requirement.id)
}

function assertEditable(spec: PromptSpecV2): void {
  if (spec.lockAll) throw new Error('all prompt blocks are locked')
}

export function removeBlock(spec: PromptSpecV2, blockId: string): PromptSpecV2 {
  assertEditable(spec)
  const block = [...spec.blocks, ...spec.negativeBlocks].find((item) => item.id === blockId)
  if (!block) throw new Error('block not found')
  if (block.locked) throw new Error('locked block cannot be removed')
  const next = structuredClone(spec)
  next.blocks = next.blocks.filter((item) => item.id !== blockId)
  next.negativeBlocks = next.negativeBlocks.filter((item) => item.id !== blockId)
  return next
}

export function removeRequirement(spec: PromptSpecV2, requirementId: string): PromptSpecV2 {
  assertEditable(spec)
  const references = [...spec.blocks, ...spec.negativeBlocks].filter((block) =>
    block.requirementRefs.includes(requirementId)
  )
  if (references.some((block) => block.locked)) {
    throw new Error('a locked block references this requirement')
  }
  const next = structuredClone(spec)
  next.sourceRequirements = next.sourceRequirements.filter((item) => item.id !== requirementId)
  for (const block of [...next.blocks, ...next.negativeBlocks]) {
    block.requirementRefs = block.requirementRefs.filter((id) => id !== requirementId)
  }
  return next
}

export function replaceMaterialRefs(spec: PromptSpecV2, materialRefs: PromptMaterialRef[]): PromptSpecV2 {
  if (materialRefs.length > 14) throw new Error('at most 14 references are allowed')
  const normalized = materialRefs.map((material) =>
    promptMaterialRefSchema.parse({ ...material, note: material.note.trim() })
  )
  const assetIds = normalized.map((material) => material.assetId)
  if (new Set(assetIds).size !== assetIds.length) throw new Error('duplicate reference asset')
  const nextAssetIds = new Set(assetIds)
  const removed = spec.materialRefs
    .map((material) => material.assetId)
    .filter((assetId) => !nextAssetIds.has(assetId))
  if (removed.length > 0) {
    const blocked = [...spec.blocks, ...spec.negativeBlocks].filter(
      (block) =>
        (spec.lockAll || block.locked) && block.materialRefs.some((assetId) => removed.includes(assetId))
    )
    if (blocked.length > 0) throw new Error('a locked block references this material')
  }
  const next = structuredClone(spec)
  next.materialRefs = normalized
  for (const block of [...next.blocks, ...next.negativeBlocks]) {
    block.materialRefs = block.materialRefs.filter((assetId) => nextAssetIds.has(assetId))
  }
  return next
}

export function makePromptBlock(negative: boolean): PromptBlock {
  return {
    id: `block-${crypto.randomUUID()}`,
    category: negative ? 'negative' : 'subject',
    label: negative ? '新负面块' : '新提示块',
    text: '待填写',
    weight: 1,
    locked: false,
    confidence: 1,
    evidence: [],
    source: 'user',
    priority: 0,
    requirementRefs: [],
    materialRefs: []
  }
}

export function makeRequirement(strength: 'must' | 'prefer' | 'avoid'): {
  id: string
  text: string
  strength: 'must' | 'prefer' | 'avoid'
} {
  return { id: `req-${crypto.randomUUID()}`, text: '', strength }
}

export function operationLabel(operation: {
  op: 'replace' | 'setWeight' | 'add' | 'remove'
  blockId?: string
  block?: PromptBlock
}): string {
  if (operation.op === 'add') return `新增块 ${operation.block?.label ?? ''}`.trim()
  if (operation.op === 'remove') return `删除块 ${operation.blockId ?? ''}`
  if (operation.op === 'setWeight') return `调整权重 ${operation.blockId ?? ''}`
  return `改写块 ${operation.blockId ?? ''}`
}
