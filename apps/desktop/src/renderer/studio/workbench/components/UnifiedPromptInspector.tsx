import React, { useState } from 'react'
import type {
  ArtProjectDto,
  ArtVersionDto,
  PromptDraftDto,
  PromptInputMaterialDto,
  PromptRequirement,
  PromptSpecV2,
  PromptVersionDto
} from '@studio/api'
import { AsyncButton, Field, InlineNotice, StatusPill, Textarea } from '@agent2live/design-system'
import { useWorkbenchStore } from '../store'
import { PromptBlockList } from './PromptBlockList'

export interface UnifiedPromptInspectorProps {
  project: ArtProjectDto
  selectedArtVersion: ArtVersionDto | null
  selectedPromptVersion: PromptVersionDto | null
  draft: PromptDraftDto | null
  spec: PromptSpecV2 | null
  requirements: PromptRequirement[]
  materials: PromptInputMaterialDto[]
  dirty: boolean
  onSave(): Promise<void>
  onGenerate(): void
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
  materials,
  dirty,
  onSave,
  onGenerate
}) => {
  const updateFullPrompt = useWorkbenchStore((state) => state.updateFullPrompt)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const historical = selectedArtVersion !== null && selectedArtVersion.id !== project.activeVersionId
  const canGenerate = !historical && !dirty && Boolean(draft || selectedPromptVersion)

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await onSave()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside
      className="workbench-design-inspector workbench-prompt-inspector"
      data-testid="unified-prompt-inspector"
    >
      <header>
        <div>
          <h2>角色描述</h2>
          <span>
            {selectedArtVersion
              ? `美术 v${selectedArtVersion.versionNumber}`
              : selectedPromptVersion
                ? `提示词 v${selectedPromptVersion.versionNumber}`
                : '提示词草稿'}
          </span>
        </div>
        <div className="workbench-prompt-status">
          {historical ? <StatusPill label="历史版本" tone="neutral" /> : null}
          <span className={dirty ? 'dirty-dot dirty' : 'dirty-dot'} aria-hidden="true" />
          <small>{dirty ? '有未保存修改' : draft ? '草稿已保存' : '版本只读'}</small>
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
                disabled={!draft}
                onValueChange={updateFullPrompt}
              />
            </Field>

            <details className="workbench-granular-editor" open>
              <summary>
                <span>颗粒化提示词</span>
                <small>{spec.blocks.length + spec.negativeBlocks.length} 块</small>
              </summary>
              <PromptBlockList
                spec={spec}
                requirements={requirements}
                materials={materials}
                disabled={!draft}
              />
            </details>
          </>
        ) : (
          <InlineNotice tone="info">正在载入当前版本的提示词…</InlineNotice>
        )}
      </div>

      <footer className="workbench-prompt-inspector-footer">
        <AsyncButton
          type="button"
          variant="secondary"
          busy={saving}
          busyLabel="保存中…"
          disabled={!draft || !dirty || saving}
          onClick={() => {
            void save()
          }}
        >
          保存草稿
        </AsyncButton>
        <AsyncButton
          type="button"
          variant="secondary"
          busy={saving}
          busyLabel="优化中…"
          disabled={!draft || !dirty || saving}
          onClick={() => {
            void save()
          }}
        >
          AI 优化
        </AsyncButton>
        <button
          type="button"
          className="workbench-prompt-generate"
          disabled={!canGenerate}
          title={historical ? '历史版本需先还原为新的当前美术版本' : undefined}
          onClick={onGenerate}
        >
          生成立绘
        </button>
      </footer>
    </aside>
  )
}
