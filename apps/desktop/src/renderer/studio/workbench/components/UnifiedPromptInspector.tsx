import React, { useState } from 'react'
import type {
  ArtProjectDto,
  ArtVersionDto,
  PromptDraftDto,
  PromptRequirement,
  PromptSpecV2,
  PromptVersionDto
} from '@studio/api'
import { AsyncButton, Button, Field, InlineNotice, StatusPill, Textarea } from '@agent2live/design-system'
import { useWorkbenchStore } from '../store'
import { PromptBlockList } from './PromptBlockList'
import { PromptReferenceEditor } from './PromptReferenceEditor'

export interface UnifiedPromptInspectorProps {
  project: ArtProjectDto
  selectedArtVersion: ArtVersionDto | null
  selectedPromptVersion: PromptVersionDto | null
  draft: PromptDraftDto | null
  spec: PromptSpecV2 | null
  requirements: PromptRequirement[]
  dirty: boolean
  onSave(): Promise<{ versionNumber: number; created: boolean }>
  onGenerate(): Promise<{ versionNumber: number; created: boolean }>
  onOpenAi(): void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const UnifiedPromptInspector: React.FC<UnifiedPromptInspectorProps> = ({
  project,
  selectedArtVersion,
  selectedPromptVersion,
  draft,
  spec,
  requirements,
  dirty,
  onSave,
  onGenerate,
  onOpenAi
}) => {
  const updateFullPrompt = useWorkbenchStore((state) => state.updateFullPrompt)
  const updateMaterialRefs = useWorkbenchStore((state) => state.updateMaterialRefs)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveResult, setSaveResult] = useState<{ versionNumber: number; created: boolean } | null>(null)
  const historical =
    (selectedArtVersion !== null && selectedArtVersion.id !== project.activeVersionId) ||
    (selectedPromptVersion !== null && selectedPromptVersion.id !== project.activePromptVersionId)
  const editable = !historical && draft !== null
  const canGenerate = selectedPromptVersion !== null

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      setSaveResult(await onSave())
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  const generate = async (): Promise<void> => {
    setGenerating(true)
    setError(null)
    try {
      setSaveResult(await onGenerate())
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <>
      <aside
        className="workbench-design-inspector workbench-prompt-inspector"
        data-testid="unified-prompt-inspector"
      >
        <header>
          <div>
            <h2>角色描述</h2>
            <span>
              {selectedArtVersion
                ? `美术 v${selectedArtVersion.versionNumber} · 提示词 v${selectedPromptVersion?.versionNumber ?? '—'}`
                : selectedPromptVersion
                  ? `提示词 v${selectedPromptVersion.versionNumber}`
                  : '提示词版本'}
            </span>
          </div>
          <div className="workbench-prompt-status">
            {historical ? <StatusPill label="历史版本" tone="neutral" /> : null}
            <span className={dirty ? 'dirty-dot dirty' : 'dirty-dot'} aria-hidden="true" />
            <small>
              {dirty
                ? '有未保存修改'
                : historical
                  ? '历史版本只读'
                  : saveResult
                    ? saveResult.created
                      ? `已创建 v${saveResult.versionNumber}`
                      : `无变更 · v${saveResult.versionNumber}`
                    : `当前 v${selectedPromptVersion?.versionNumber ?? '—'}`}
            </small>
          </div>
        </header>

        <div className="workbench-prompt-inspector-scroll">
          {error ? (
            <div role="alert">
              <InlineNotice tone="danger">{error}</InlineNotice>
            </div>
          ) : null}

          {spec ? (
            <>
              <Field label="完整提示词">
                <Textarea
                  aria-label="完整提示词"
                  rows={8}
                  maxLength={20_000}
                  value={spec.fullPrompt}
                  disabled={!editable}
                  onValueChange={updateFullPrompt}
                />
              </Field>

              <details className="workbench-granular-editor" open>
                <summary>
                  <span>颗粒化提示词</span>
                  <small>{spec.blocks.length + spec.negativeBlocks.length} 块</small>
                </summary>
                <PromptBlockList spec={spec} requirements={requirements} disabled={!editable} />
              </details>

              <details className="workbench-granular-editor" open>
                <summary>
                  <span>参考图</span>
                  <small>{spec.materialRefs.length} 张</small>
                </summary>
                <PromptReferenceEditor
                  references={spec.materialRefs}
                  disabled={!editable}
                  onChange={updateMaterialRefs}
                />
              </details>
            </>
          ) : (
            <InlineNotice tone="info">正在载入当前版本的提示词…</InlineNotice>
          )}
        </div>

        <footer className="workbench-prompt-inspector-footer">
          <div className="workbench-prompt-utility-actions">
            <Button
              type="button"
              variant="quiet"
              size="sm"
              disabled={!draft && !selectedPromptVersion}
              onClick={onOpenAi}
            >
              AI 助手
            </Button>
          </div>
          <AsyncButton
            type="button"
            variant="secondary"
            busy={saving}
            busyLabel="保存中…"
            disabled={!editable || saving || generating}
            onClick={() => {
              void save()
            }}
          >
            保存
          </AsyncButton>
          <AsyncButton
            type="button"
            variant="secondary"
            busy={saving}
            busyLabel="优化中…"
            disabled={!editable || saving || generating}
            onClick={() => {
              void save()
            }}
          >
            AI 优化
          </AsyncButton>
          <button
            type="button"
            className="workbench-prompt-generate"
            disabled={!canGenerate || saving || generating}
            onClick={() => {
              void generate()
            }}
          >
            {generating ? '准备生成…' : '生成立绘'}
          </button>
        </footer>
      </aside>
    </>
  )
}
