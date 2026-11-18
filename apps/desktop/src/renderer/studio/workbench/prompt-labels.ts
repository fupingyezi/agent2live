import type { MaterialRole } from '@studio/api'

export const MATERIAL_ROLE_LABELS: Record<MaterialRole, string> = {
  identity_reference: '身份',
  style_reference: '画风',
  outfit_reference: '服装',
  color_reference: '配色',
  background_reference: '背景',
  pose_reference: '姿态',
  sketch: '草图',
  texture: '材质',
  other: '参考'
}

export const ART_SOURCE_LABELS = {
  generated: '生成',
  manual_upload: '上传',
  fork_seed: '分支'
} as const

export const PROMPT_STRENGTH_LABELS = {
  must: '必须',
  prefer: '倾向',
  avoid: '避免'
} as const
