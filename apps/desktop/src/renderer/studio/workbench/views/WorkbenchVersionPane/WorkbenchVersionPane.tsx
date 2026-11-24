import React from 'react'
import { useNavigate } from 'react-router-dom'
import type { UseQueryResult } from '@tanstack/react-query'
import type { ArtProjectDto, ArtVersionDto, PromptVersionDto } from '@studio/api'
import { Button, InlineNotice } from '@agent2live/design-system'
import { StudioError, StudioLoading } from '@studio/components'
import { ArtVersionView } from '../ArtVersionView'
import { errorMessage } from '../../workbench-helpers'
import styles from './WorkbenchVersionPane.module.scss'

export interface WorkbenchVersionPaneProps {
  project: ArtProjectDto
  versionsQuery: UseQueryResult<ArtVersionDto[], Error>
  currentVersion: ArtVersionDto | null
  promptVersion: PromptVersionDto | null
  error: string | null
  onBackToPrompt: () => void
  onRegenerate: () => void
}

export const WorkbenchVersionPane: React.FC<WorkbenchVersionPaneProps> = ({
  project,
  versionsQuery,
  currentVersion,
  promptVersion,
  error,
  onBackToPrompt,
  onRegenerate
}) => {
  const navigate = useNavigate()

  if (versionsQuery.isPending) {
    return (
      <section className={styles['loading']!}>
        <StudioLoading label="正在加载当前立绘…" />
      </section>
    )
  }

  if (versionsQuery.isError && !versionsQuery.data) {
    return (
      <section className={styles['loading']!} data-testid="versions-error">
        <StudioError
          error={versionsQuery.error}
          onRetry={() => {
            void versionsQuery.refetch()
          }}
        />
      </section>
    )
  }

  return (
    <div className={styles['version-shell']!}>
      {versionsQuery.isError ? (
        <div className={styles['version-refetch-error']!} data-testid="wb3-version-refetch-error">
          <InlineNotice tone="danger">
            刷新当前立绘失败：{errorMessage(versionsQuery.error) ?? '请重试。'}
          </InlineNotice>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void versionsQuery.refetch()
            }}
          >
            重试
          </Button>
        </div>
      ) : null}
      <ArtVersionView
        project={project}
        currentVersion={currentVersion}
        promptVersion={promptVersion}
        error={error}
        onBackToPrompt={onBackToPrompt}
        onRegenerate={onRegenerate}
        onOpenLayered={() => {
          if (currentVersion) {
            navigate(
              `/characters/${encodeURIComponent(project.characterId)}/live2d?artVersion=${encodeURIComponent(currentVersion.id)}`
            )
          }
        }}
      />
    </div>
  )
}
