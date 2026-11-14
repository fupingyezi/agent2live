import type { PromptSpecV2 } from '@agent2live/contracts'

export function specFixture(): PromptSpecV2 {
  return {
    schemaVersion: 'prompt-spec/2',
    lockAll: false,
    sourceRequirements: [
      { id: 'req_identity', text: '银白长发与蓝色眼睛', strength: 'must' },
      { id: 'req_style', text: '清爽赛璐璐', strength: 'prefer' },
      { id: 'req_avoid', text: '避免写实皮肤', strength: 'avoid' }
    ],
    materialRefs: [
      {
        assetId: 'ast_01J00000000000000000000000',
        role: 'identity_reference',
        note: '脸型参考',
        weight: 1,
        locked: true
      }
    ],
    blocks: [
      {
        id: 'subject.identity',
        category: 'subject',
        label: '人物身份',
        text: '银白长发的蓝眼少女，正视半身',
        weight: 1,
        locked: true,
        confidence: 0.95,
        evidence: [{ assetId: 'ast_01J00000000000000000000000' }],
        source: 'vision-model',
        priority: 100,
        requirementRefs: ['req_identity'],
        materialRefs: ['ast_01J00000000000000000000000']
      },
      {
        id: 'style.rendering',
        category: 'style',
        label: '渲染风格',
        text: '清爽的日系赛璐璐插画，干净线稿',
        weight: 1,
        locked: false,
        confidence: 0.8,
        evidence: [],
        source: 'vision-model',
        priority: 80,
        requirementRefs: ['req_style'],
        materialRefs: []
      },
      {
        id: 'background.simple',
        category: 'background',
        label: '背景',
        text: '淡蓝色渐变背景',
        weight: 1,
        locked: false,
        confidence: 0.5,
        evidence: [],
        source: 'vision-model',
        priority: 30,
        requirementRefs: [],
        materialRefs: []
      }
    ],
    negativeBlocks: [
      {
        id: 'negative.realism',
        category: 'negative',
        label: '禁止写实',
        text: '写实皮肤、照片质感、厚涂',
        weight: 1,
        locked: true,
        confidence: 1,
        evidence: [],
        source: 'user',
        priority: 100,
        requirementRefs: ['req_avoid'],
        materialRefs: []
      }
    ],
    constraints: { canvas: { width: 1024, height: 1792 }, background: 'transparent', aspect: 'portrait' }
  }
}
