import { describe, expect, it } from 'vitest'
import { characterBriefContentSchema, type CharacterBriefContent } from '@agent2live/contracts'
import {
  assertBriefProjection,
  briefToContextText,
  mergeBriefProjection,
  projectBriefToPromptBlocks
} from '../src/prompt/brief-projection'
import { specFixture } from './fixtures/spec'

function briefFixture(): CharacterBriefContent {
  return characterBriefContentSchema.parse({
    schemaVersion: 'character-brief/1',
    identity: {
      fullName: '雾原铃',
      aliases: ['小铃'],
      age: '19',
      gender: '女性',
      species: '人类'
    },
    social: { occupation: '机械师', affiliation: '旅行者公会' },
    background: { summary: '在北境工业城长大，工坊火灾后独自旅行。' },
    appearance: {
      height: '162cm',
      build: '纤细但结实',
      skinTone: '冷白肤色',
      face: '小脸，下颌线清晰',
      eyes: '碧绿色眼睛',
      hair: '层次短发，银灰色',
      outfit: '深蓝色工装外套',
      palette: ['深蓝', '黄铜色'],
      accessories: ['右手机械护腕'],
      distinctiveFeatures: ['左眼下泪痣'],
      defaultPose: '微微前倾查看机械',
      defaultExpression: '嘴角很轻的戒备'
    },
    personality: { traits: ['谨慎', '嘴硬'], speechStyle: '简短、避免敬语' },
    behavior: { bodyLanguage: '说话时会把扳手在指间转半圈' }
  })
}

describe('brief projection', () => {
  it('projects only visual brief facts into locked blocks', () => {
    const blocks = projectBriefToPromptBlocks(briefFixture())
    expect(blocks.map((block) => block.id)).toEqual([
      'brief.identity',
      'brief.appearance.body',
      'brief.appearance.face',
      'brief.appearance.hair',
      'brief.appearance.outfit',
      'brief.appearance.accessories',
      'brief.appearance.palette',
      'brief.appearance.pose',
      'brief.appearance.expression',
      'brief.behavior.bodyLanguage'
    ])
    expect(blocks.every((block) => block.locked)).toBe(true)
    expect(blocks.every((block) => block.source === 'character-brief')).toBe(true)
    expect(blocks.every((block) => block.confidence === 1)).toBe(true)
    expect(
      blocks.every((block) => block.requirementRefs.length === 0 && block.materialRefs.length === 0)
    ).toBe(true)
    expect(blocks.find((block) => block.id === 'brief.identity')?.text).toContain('雾原铃')
    expect(blocks.find((block) => block.id === 'brief.appearance.hair')?.text).toContain('银灰色')
    expect(blocks.find((block) => block.id === 'brief.appearance.body')?.text).toContain('左眼下泪痣')
    expect(JSON.stringify(blocks)).not.toContain('谨慎')
    expect(JSON.stringify(blocks)).not.toContain('北境工业城')
  })

  it('is deterministic and replaces only prior brief-projected blocks', () => {
    const brief = briefFixture()
    expect(projectBriefToPromptBlocks(brief)).toEqual(projectBriefToPromptBlocks(brief))
    const merged = mergeBriefProjection(specFixture(), brief)
    expect(merged.blocks.filter((block) => block.source === 'character-brief')).toHaveLength(10)
    expect(merged.blocks.some((block) => block.id === 'subject.identity')).toBe(true)
    expect(mergeBriefProjection(merged, brief)).toEqual(merged)
  })

  it('reserves the brief.* block namespace', () => {
    const spec = specFixture()
    spec.blocks.push({ ...spec.blocks[1]!, id: 'brief.identity', source: 'user' })
    expect(() => mergeBriefProjection(spec, briefFixture())).toThrowError(
      expect.objectContaining({ code: 'PROMPT_OPERATION_INVALID' })
    )
  })

  it('detects drift from the pinned brief projection', () => {
    const brief = briefFixture()
    const merged = mergeBriefProjection(specFixture(), brief)
    expect(() => assertBriefProjection(merged, brief)).not.toThrow()
    const tampered = {
      ...merged,
      blocks: merged.blocks.map((block) =>
        block.id === 'brief.appearance.hair' ? { ...block, text: '黑色长发' } : block
      )
    }
    expect(() => assertBriefProjection(tampered, brief)).toThrowError(
      expect.objectContaining({ code: 'PROMPT_BRIEF_PROJECTION_STALE' })
    )
  })

  it('includes non-visual dimensions only in AI context', () => {
    const brief = briefFixture()
    const context = briefToContextText(brief)
    expect(context).toContain('谨慎')
    expect(context).toContain('北境工业城')
    expect(context).toContain('<character_brief>')
    expect(JSON.stringify(projectBriefToPromptBlocks(brief))).not.toContain('谨慎')
  })

  it('projects nothing for an empty brief', () => {
    const empty = characterBriefContentSchema.parse({ schemaVersion: 'character-brief/1' })
    expect(projectBriefToPromptBlocks(empty)).toEqual([])
    expect(mergeBriefProjection(specFixture(), empty).blocks).toHaveLength(3)
  })
})
