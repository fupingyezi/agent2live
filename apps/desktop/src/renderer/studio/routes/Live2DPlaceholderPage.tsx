import React from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, EmptyState, PageHeader, type EmptyProps } from '@agent2live/design-system'
import { getArtProject, getCharacter } from '@studio/api'
import { queryKeys } from '@studio/api'
import { StudioError } from '@studio/components'
import { StudioLoading } from '@studio/components'

export const Live2DPlaceholderPage: React.FC<EmptyProps> = () => {
  const { characterId } = useParams<{ characterId: string }>()
  const [searchParams] = useSearchParams()
  const projectId = searchParams.get('project')
  const id = characterId ?? ''

  const characterQuery = useQuery({
    queryKey: queryKeys.character(id),
    queryFn: ({ signal }) => getCharacter(id, signal),
    enabled: Boolean(id)
  })
  const projectQuery = useQuery({
    queryKey: queryKeys.project(projectId ?? 'none'),
    queryFn: ({ signal }) => {
      if (!projectId) throw new Error('project id is missing')
      return getArtProject(projectId, signal)
    },
    enabled: Boolean(projectId)
  })

  if (!characterId) return <Navigate to="/" replace />
  if (characterQuery.isPending) {
    return (
      <div className="studio-page live2d-page">
        <StudioLoading label="正在加载角色…" />
      </div>
    )
  }
  if (characterQuery.isError) {
    return (
      <div className="studio-page live2d-page">
        <StudioError
          error={characterQuery.error}
          onRetry={() => {
            void characterQuery.refetch()
          }}
        />
      </div>
    )
  }

  const projectTitle = projectQuery.data?.title ?? null
  const cockpitPath = `/characters/${encodeURIComponent(characterId)}`
  const artPath = `/characters/${encodeURIComponent(characterId)}/art${projectId ? `?project=${encodeURIComponent(projectId)}` : ''}`

  return (
    <div
      className="studio-page live2d-page"
      data-testid="live2d-placeholder"
      data-character-id={characterId}
      data-project-id={projectId ?? ''}
    >
      <PageHeader
        back={
          <Button asChild variant="quiet" size="sm">
            <Link to={cockpitPath}>返回角色驾驶舱</Link>
          </Button>
        }
        eyebrow="Live2D"
        title={characterQuery.data.title}
        description={
          projectTitle ? `美术来源：${projectTitle}` : '尚未选择美术项目；可以先在驾驶舱里打开一个项目。'
        }
      />

      <div className="live2d-stage" aria-hidden="true">
        <span>L2D</span>
      </div>
      <div data-testid="live2d-empty">
        <EmptyState
          icon="L2D"
          title="Live2D 绑定将在 Phase 2 开放"
          description="Phase 1 先确保角色母体、提示词、美术版本与备份链路可靠；绑定、参数映射和预览会在后续计划中接入。"
          action={
            <Button asChild>
              <Link to={artPath}>返回美术工作台</Link>
            </Button>
          }
        />
      </div>
    </div>
  )
}
