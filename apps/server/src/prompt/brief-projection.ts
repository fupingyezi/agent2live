import type { CharacterBriefContent, PromptBlock, PromptSpecV2 } from '@agent2live/contracts'
import { AppError } from '../errors'

const MAX_BLOCK_CHARS = 4000
const BRIEF_BLOCK_PREFIX = 'brief.'

interface BlockSpec {
  id: string
  category: PromptBlock['category']
  label: string
  priority: number
  parts: string[]
}

function textLength(text: string): number {
  return Array.from(text).length
}

function clean(parts: string[]): string[] {
  return parts.map((part) => part.trim()).filter((part) => part.length > 0)
}

function labeled(label: string, values: string[]): string[] {
  return clean(values).map((value) => `${label}：${value}`)
}

function pack(parts: string[], limit = MAX_BLOCK_CHARS): string[] {
  const chunks: string[] = []
  let current = ''
  for (const part of parts) {
    const candidate = current ? `${current}；${part}` : part
    if (textLength(candidate) <= limit) {
      current = candidate
      continue
    }
    if (current) chunks.push(current)
    const chars = Array.from(part)
    if (chars.length <= limit) {
      current = part
      continue
    }
    for (let index = 0; index < chars.length; index += limit) {
      chunks.push(chars.slice(index, index + limit).join(''))
    }
    current = ''
  }
  if (current) chunks.push(current)
  return chunks
}

function toBlocks(spec: BlockSpec): PromptBlock[] {
  const chunks = pack(clean(spec.parts))
  return chunks.map((text, index) => ({
    id: chunks.length === 1 ? spec.id : `${spec.id}.${index + 1}`,
    category: spec.category,
    label: spec.label,
    text,
    weight: 1,
    locked: true,
    confidence: 1,
    evidence: [],
    source: 'character-brief',
    priority: spec.priority,
    requirementRefs: [],
    materialRefs: []
  }))
}

export function projectBriefToPromptBlocks(brief: CharacterBriefContent): PromptBlock[] {
  const identity = brief.identity
  const appearance = brief.appearance
  const specs: BlockSpec[] = [
    {
      id: `${BRIEF_BLOCK_PREFIX}identity`,
      category: 'subject',
      label: '角色身份',
      priority: 100,
      parts: [
        identity.fullName,
        ...labeled('别名', identity.aliases),
        ...labeled('代号', identity.codeNames),
        ...labeled('年龄', [identity.age]),
        ...labeled('性别', [identity.gender]),
        ...labeled('种族', [identity.species]),
        ...labeled('生日', [identity.birthday])
      ]
    },
    {
      id: `${BRIEF_BLOCK_PREFIX}appearance.body`,
      category: 'subject',
      label: '外观·身体',
      priority: 95,
      parts: [
        ...labeled('身高', [appearance.height]),
        ...labeled('体型', [appearance.build]),
        ...labeled('肤色', [appearance.skinTone]),
        ...labeled('特征', appearance.distinctiveFeatures)
      ]
    },
    {
      id: `${BRIEF_BLOCK_PREFIX}appearance.face`,
      category: 'face',
      label: '外观·面部',
      priority: 90,
      parts: [...labeled('面部', [appearance.face]), ...labeled('眼睛', [appearance.eyes])]
    },
    {
      id: `${BRIEF_BLOCK_PREFIX}appearance.hair`,
      category: 'hair',
      label: '外观·头发',
      priority: 85,
      parts: labeled('头发', [appearance.hair])
    },
    {
      id: `${BRIEF_BLOCK_PREFIX}appearance.outfit`,
      category: 'outfit',
      label: '外观·服装',
      priority: 80,
      parts: labeled('服装', [appearance.outfit])
    },
    {
      id: `${BRIEF_BLOCK_PREFIX}appearance.accessories`,
      category: 'outfit',
      label: '外观·配饰',
      priority: 78,
      parts: labeled('配饰', appearance.accessories)
    },
    {
      id: `${BRIEF_BLOCK_PREFIX}appearance.palette`,
      category: 'style',
      label: '外观·配色',
      priority: 60,
      parts: labeled('配色', appearance.palette)
    },
    {
      id: `${BRIEF_BLOCK_PREFIX}appearance.pose`,
      category: 'pose',
      label: '外观·姿势',
      priority: 70,
      parts: labeled('姿势', [appearance.defaultPose])
    },
    {
      id: `${BRIEF_BLOCK_PREFIX}appearance.expression`,
      category: 'face',
      label: '外观·表情',
      priority: 75,
      parts: labeled('表情', [appearance.defaultExpression])
    },
    {
      id: `${BRIEF_BLOCK_PREFIX}behavior.bodyLanguage`,
      category: 'pose',
      label: '行为·肢体语言',
      priority: 50,
      parts: labeled('肢体语言', [brief.behavior.bodyLanguage])
    }
  ]
  return specs.flatMap(toBlocks)
}

export function mergeBriefProjection(spec: PromptSpecV2, brief: CharacterBriefContent): PromptSpecV2 {
  const preserved = spec.blocks.filter((block) => block.source !== 'character-brief')
  if (preserved.some((block) => block.id.startsWith(BRIEF_BLOCK_PREFIX))) {
    throw new AppError('PROMPT_OPERATION_INVALID', { reason: 'brief_block_id_reserved' })
  }
  return { ...spec, blocks: [...preserved, ...projectBriefToPromptBlocks(brief)] }
}

function projectionKey(blocks: PromptBlock[]): string {
  return JSON.stringify([...blocks].sort((left, right) => left.id.localeCompare(right.id)))
}

export function assertBriefProjection(spec: PromptSpecV2, brief: CharacterBriefContent): void {
  const actual = spec.blocks.filter((block) => block.source === 'character-brief')
  if (projectionKey(actual) !== projectionKey(projectBriefToPromptBlocks(brief))) {
    throw new AppError('PROMPT_BRIEF_PROJECTION_STALE', {})
  }
}

export function briefToContextText(brief: CharacterBriefContent): string {
  return `<character_brief>\n${JSON.stringify(brief, null, 2)}\n</character_brief>`
}
