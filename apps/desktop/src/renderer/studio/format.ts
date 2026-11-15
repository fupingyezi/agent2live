import type { StatusTone } from '@agent2live/design-system'
import type { ArtProjectStage } from '@studio/api'

const STAGE_LABELS: Record<ArtProjectStage, string> = {
  idea_draft: '构思草稿',
  prompt_draft: '提示词草稿',
  prompt_ready: '提示词就绪',
  generating: '生成中',
  candidate_review: '候选评审',
  art_version_active: '美术版本已激活',
  live2d_pending: '待绑定 Live2D',
  blocked: '已阻塞'
}

const STAGE_TONES: Record<ArtProjectStage, StatusTone> = {
  idea_draft: 'neutral',
  prompt_draft: 'neutral',
  prompt_ready: 'accent',
  generating: 'accent',
  candidate_review: 'warning',
  art_version_active: 'success',
  live2d_pending: 'accent',
  blocked: 'danger'
}

export function formatStage(stage: ArtProjectStage): string {
  return STAGE_LABELS[stage] ?? stage
}

export function stageTone(stage: ArtProjectStage): StatusTone {
  return STAGE_TONES[stage] ?? 'neutral'
}

export function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false
  }).format(date)
}

export function shortId(value: string, visible = 12): string {
  return value.length <= visible ? value : `…${value.slice(-visible)}`
}

export function formatPercent(percent: number): string {
  return `${Math.round(Math.min(100, Math.max(0, percent)))}%`
}

export function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
