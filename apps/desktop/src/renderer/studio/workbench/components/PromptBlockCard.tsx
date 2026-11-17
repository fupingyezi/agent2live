import React, { useState } from 'react'
import { PROMPT_CATEGORIES } from '@agent2live/contracts/prompt'
import type { PromptBlock, PromptMaterialRef, PromptRequirement } from '@studio/api'
import { useWorkbenchStore } from '../store'
import {
  Button,
  ConfirmDialog,
  Field,
  IconButton,
  Select,
  StatusPill,
  Switch,
  TextField,
  Textarea
} from '@agent2live/design-system'

const CATEGORY_LABELS: Record<string, string> = {
  subject: '主体',
  face: '面部',
  hair: '头发',
  outfit: '服装',
  pose: '姿态',
  composition: '构图',
  style: '风格',
  lighting: '光照',
  background: '背景',
  safety: '安全',
  negative: '负面',
  other: '其他'
}

const SOURCE_LABELS: Record<string, string> = {
  user: '用户',
  'vision-model': '视觉模型',
  template: '模板',
  'ai-suggestion': 'AI 建议',
  import: '导入'
}

const MATERIAL_ROLE_LABELS: Record<string, string> = {
  identity_reference: '身份参考',
  style_reference: '风格参考',
  outfit_reference: '服装参考',
  color_reference: '配色参考',
  background_reference: '背景参考',
  pose_reference: '姿态参考',
  sketch: '草图',
  texture: '材质',
  other: '其他'
}

const STRENGTH_LABELS = { must: '必须', prefer: '偏好', avoid: '避免' } as const

function materialLabel(material: PromptMaterialRef, index: number): string {
  const role = MATERIAL_ROLE_LABELS[material.role] ?? material.role
  return material.note ? `${role} · ${material.note}` : `${role} ${index + 1}`
}

export interface PromptBlockCardProps {
  block: PromptBlock
  negative: boolean
  requirements: PromptRequirement[]
  materials: PromptMaterialRef[]
  disabled: boolean
}

export const PromptBlockCard: React.FC<PromptBlockCardProps> = ({
  block,
  negative,
  requirements,
  materials,
  disabled
}) => {
  const store = useWorkbenchStore()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const locked = block.locked || store.draft?.lockAll === true
  const controlsDisabled = disabled || locked

  const compatibleRequirements = requirements.filter((requirement) =>
    negative ? requirement.strength === 'avoid' : requirement.strength !== 'avoid'
  )

  const toggleRequirement = (id: string): void => {
    const next = block.requirementRefs.includes(id)
      ? block.requirementRefs.filter((value) => value !== id)
      : [...block.requirementRefs, id]
    store.updateBlockReferences(block.id, { requirementRefs: next })
  }

  const toggleMaterial = (assetId: string): void => {
    const next = block.materialRefs.includes(assetId)
      ? block.materialRefs.filter((value) => value !== assetId)
      : [...block.materialRefs, assetId]
    store.updateBlockReferences(block.id, { materialRefs: next })
  }

  return (
    <article
      className={`prompt-block${negative ? ' negative-block' : ''}${locked ? ' locked-block' : ''}`}
      data-testid="prompt-block"
      data-block-id={block.id}
    >
      <header className="prompt-block-head">
        <Field label="块名称" className="block-label-field">
          <TextField
            value={block.label}
            maxLength={100}
            disabled={controlsDisabled}
            onValueChange={(label) => store.updateBlock(block.id, { label })}
          />
        </Field>
        <div className="block-pills">
          <StatusPill label={SOURCE_LABELS[block.source] ?? block.source} />
          {block.source === 'vision-model' || block.source === 'ai-suggestion' ? (
            <StatusPill label={`置信度 ${Math.round(block.confidence * 100)}%`} tone="accent" />
          ) : null}
          <Field label={store.draft?.lockAll ? '全局锁定中' : '锁定此块'} className="block-lock-field">
            <Switch
              checked={block.locked}
              disabled={disabled || store.draft?.lockAll}
              onCheckedChange={() => store.toggleBlockLock(block.id)}
            />
          </Field>
          <IconButton
            type="button"
            variant="quiet"
            label="删除块"
            disabled={controlsDisabled}
            onClick={() => setConfirmDelete(true)}
          >
            ×
          </IconButton>
        </div>
      </header>

      <div className="block-meta-row">
        <Field label="类别" className="block-category-field">
          <Select
            value={block.category}
            disabled={controlsDisabled}
            onValueChange={(value) =>
              store.updateBlock(block.id, { category: value as PromptBlock['category'] })
            }
          >
            {PROMPT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {CATEGORY_LABELS[category] ?? category}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="权重" className="block-weight-field">
          <TextField
            type="number"
            min={0.1}
            max={2}
            step={0.1}
            value={block.weight}
            disabled={controlsDisabled}
            onValueChange={(value) => store.updateBlockWeight(block.id, Number(value))}
          />
        </Field>
      </div>

      <Field label="提示词内容">
        <Textarea
          aria-label="块内容"
          rows={4}
          maxLength={4000}
          value={block.text}
          disabled={controlsDisabled}
          onValueChange={(text) => store.updateBlock(block.id, { text })}
        />
      </Field>

      {compatibleRequirements.length > 0 ? (
        <fieldset className="block-refs" disabled={controlsDisabled}>
          <legend>关联要求</legend>
          <div className="block-ref-options">
            {compatibleRequirements.map((requirement) => {
              const selected = block.requirementRefs.includes(requirement.id)
              return (
                <Button
                  key={requirement.id}
                  type="button"
                  variant={selected ? 'secondary' : 'quiet'}
                  size="sm"
                  aria-pressed={selected}
                  disabled={controlsDisabled}
                  onClick={() => toggleRequirement(requirement.id)}
                >
                  <StatusPill
                    label={STRENGTH_LABELS[requirement.strength]}
                    tone={
                      requirement.strength === 'must'
                        ? 'warning'
                        : requirement.strength === 'avoid'
                          ? 'danger'
                          : 'neutral'
                    }
                  />
                  {requirement.text || '（未填写）'}
                </Button>
              )
            })}
          </div>
        </fieldset>
      ) : null}

      {materials.length > 0 ? (
        <fieldset className="block-refs" disabled={controlsDisabled}>
          <legend>引用素材</legend>
          <div className="block-ref-options">
            {materials.map((material, index) => {
              const selected = block.materialRefs.includes(material.assetId)
              return (
                <Button
                  key={material.assetId}
                  type="button"
                  variant={selected ? 'secondary' : 'quiet'}
                  size="sm"
                  aria-pressed={selected}
                  disabled={controlsDisabled}
                  onClick={() => toggleMaterial(material.assetId)}
                >
                  {materialLabel(material, index)}
                </Button>
              )
            })}
          </div>
        </fieldset>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title="删除这个提示词块？"
        destructive
        confirmLabel="删除"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          store.removeBlock(block.id)
          setConfirmDelete(false)
        }}
      >
        <p>删除只影响当前编辑内容；保存后才生成新的提示词版本。</p>
      </ConfirmDialog>
    </article>
  )
}
