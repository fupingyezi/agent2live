import { PROMPT_CATEGORIES } from '@agent2live/contracts/prompt'
import type { PromptBlock, PromptSpecV2 } from '@studio/api'

export type PromptCategory = (typeof PROMPT_CATEGORIES)[number]

export const PROMPT_CATEGORY_LABELS: Record<PromptCategory, string> = {
  subject: '主体',
  face: '面部',
  hair: '头发',
  outfit: '服装',
  pose: '姿态',
  composition: '构图',
  style: '风格',
  lighting: '光线',
  background: '背景',
  safety: '安全',
  negative: '负向',
  other: '其他'
}

export type PromptBlockStatus = 'pending' | 'shadowed' | 'locked' | 'negative'
export type PromptFilter = 'all' | PromptCategory | PromptBlockStatus

export interface PromptFilterOption {
  id: PromptCategory | PromptBlockStatus
  label: string
  count: number
}

export interface PromptFilterModel {
  categories: PromptFilterOption[]
  statuses: PromptFilterOption[]
  total: number
}

export interface PromptBlockGroup {
  id: PromptCategory
  label: string
  negative: boolean
  blocks: PromptBlock[]
}

const PLACEHOLDER_TEXTS = new Set(['待填写'])

export function isPendingBlock(block: PromptBlock): boolean {
  const text = block.text.trim()
  return text.length === 0 || PLACEHOLDER_TEXTS.has(text)
}

export function shadowedBlockIds(spec: PromptSpecV2): Set<string> {
  const groups = new Map<string, PromptBlock[]>()
  for (const block of spec.blocks) {
    const key = `${block.category}::${block.label}`
    const list = groups.get(key) ?? []
    list.push(block)
    groups.set(key, list)
  }
  const ids = new Set<string>()
  for (const list of groups.values()) {
    for (const block of list.slice(0, -1)) ids.add(block.id)
  }
  return ids
}

export function promptFilterModel(spec: PromptSpecV2): PromptFilterModel {
  const counts = new Map<PromptCategory, number>()
  for (const block of spec.blocks) {
    counts.set(block.category, (counts.get(block.category) ?? 0) + 1)
  }
  const categories: PromptFilterOption[] = PROMPT_CATEGORIES.filter(
    (category) => category !== 'negative' && (counts.get(category) ?? 0) > 0
  ).map((category) => ({
    id: category,
    label: PROMPT_CATEGORY_LABELS[category],
    count: counts.get(category) ?? 0
  }))
  const negativeCount = spec.negativeBlocks.length
  if (negativeCount > 0) {
    categories.push({ id: 'negative', label: PROMPT_CATEGORY_LABELS.negative, count: negativeCount })
  }

  const shadowed = shadowedBlockIds(spec)
  const pending = spec.blocks.filter(isPendingBlock).length
  const locked = [...spec.blocks, ...spec.negativeBlocks].filter(
    (block) => spec.lockAll || block.locked
  ).length
  const statuses: PromptFilterOption[] = []
  if (pending > 0) statuses.push({ id: 'pending', label: '待补', count: pending })
  if (shadowed.size > 0) statuses.push({ id: 'shadowed', label: '被覆盖', count: shadowed.size })
  if (locked > 0) statuses.push({ id: 'locked', label: '已锁', count: locked })

  return {
    categories,
    statuses,
    total: spec.blocks.length + spec.negativeBlocks.length
  }
}

function matchesFilter(
  block: PromptBlock,
  negative: boolean,
  spec: PromptSpecV2,
  filter: PromptFilter,
  shadowed: Set<string>
): boolean {
  if (filter === 'all') return true
  if (filter === 'negative') return negative
  if (filter === 'pending') return !negative && isPendingBlock(block)
  if (filter === 'shadowed') return !negative && shadowed.has(block.id)
  if (filter === 'locked') return spec.lockAll || block.locked
  return !negative && block.category === filter
}

export function promptBlockGroups(spec: PromptSpecV2, filter: PromptFilter): PromptBlockGroup[] {
  const shadowed = shadowedBlockIds(spec)
  const groups: PromptBlockGroup[] = []
  for (const category of PROMPT_CATEGORIES) {
    if (category === 'negative') continue
    const blocks = spec.blocks.filter(
      (block) => block.category === category && matchesFilter(block, false, spec, filter, shadowed)
    )
    if (blocks.length > 0) {
      groups.push({
        id: category,
        label: PROMPT_CATEGORY_LABELS[category],
        negative: false,
        blocks
      })
    }
  }
  const negatives = spec.negativeBlocks.filter((block) => matchesFilter(block, true, spec, filter, shadowed))
  if (negatives.length > 0) {
    groups.push({
      id: 'negative',
      label: PROMPT_CATEGORY_LABELS.negative,
      negative: true,
      blocks: negatives
    })
  }
  return groups
}

export function blockLabelById(blockId: string, spec: PromptSpecV2): string {
  const block = [...spec.blocks, ...spec.negativeBlocks].find((item) => item.id === blockId)
  return block?.label ?? '未知条目'
}
