import React, { useEffect } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, EmptyState, PageHeader, StatusPill, type EmptyProps } from '@agent2live/design-system'
import { flattenLineage, getArtProject, getCharacterLineage } from '@studio/api'
import { ApiError } from '@studio/api'
import { queryKeys } from '@studio/api'
import { StudioError } from '@studio/components'
import { StudioLoading } from '@studio/components'
import { formatStage, stageTone } from '@studio/format'
import { Workbench } from '@studio/workbench'

export const ArtWorkbenchPage: React.FC<EmptyProps> = () => {
  const { characterId } = useParams<{ characterId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const projectId = searchParams.get('project')
  const id = characterId ?? ''

  const projectQuery = useQuery({
    queryKey: queryKeys.project(projectId ?? 'none'),
    queryFn: ({ signal }) => {
      if (!projectId) throw new Error('project id is missing')
      return getArtProject(projectId, signal)
    },
    enabled: Boolean(projectId)
  })
  const lineageQuery = useQuery({
    queryKey: queryKeys.lineage(id),
    queryFn: ({ signal }) => getCharacterLineage(id, signal),
    enabled: Boolean(id) && !projectId
  })

  const firstProject = lineageQuery.data ? (flattenLineage(lineageQuery.data.roots)[0] ?? null) : null
  // A character with no projects gets 404 from the lineage endpoint; render the
  // workbench's empty state rather than a not-found error.
  const lineageMissing = lineageQuery.error instanceof ApiError && lineageQuery.error.status === 404

  useEffect(() => {
    if (projectId || !id || !firstProject) return
    navigate(`/characters/${encodeURIComponent(id)}/art?project=${encodeURIComponent(firstProject.id)}`, {
      replace: true
    })
  }, [projectId, id, firstProject, navigate])

  if (!characterId) return <Navigate to="/" replace />

  if (!projectId) {
    if (lineageQuery.isPending) {
      return (
        <div className="studio-page">
          <StudioLoading label="正在选择美术项目…" />
        </div>
      )
    }
    if (lineageQuery.isError && !lineageMissing) {
      return (
        <div className="studio-page">
          <StudioError
            error={lineageQuery.error}
            onRetry={() => {
              void lineageQuery.refetch()
            }}
          />
        </div>
      )
    }
    if (!firstProject) {
      return (
        <div className="studio-page" data-testid="art-workbench">
          <EmptyState
            icon="◇"
            title="还没有可打开的美术项目"
            description="先在角色驾驶舱创建一个项目。"
            action={
              <Button asChild>
                <Link to={`/characters/${encodeURIComponent(id)}`}>返回角色驾驶舱</Link>
              </Button>
            }
          />
        </div>
      )
    }
    return (
      <div className="studio-page">
        <StudioLoading label="正在打开项目…" />
      </div>
    )
  }

  if (projectQuery.isPending) {
    return (
      <div className="studio-page">
        <StudioLoading label="正在加载美术项目…" />
      </div>
    )
  }
  if (projectQuery.isError) {
    return (
      <div className="studio-page">
        <StudioError
          error={projectQuery.error}
          onRetry={() => {
            void projectQuery.refetch()
          }}
        />
      </div>
    )
  }

  const project = projectQuery.data
  return (
    <div
      className="studio-page studio-art-workbench"
      data-testid="art-workbench"
      data-project-id={project.id}
    >
      <PageHeader
        back={
          <Link className="studio-back" to={`/characters/${encodeURIComponent(characterId)}`}>
            ← 返回角色驾驶舱
          </Link>
        }
        eyebrow="美术工作台"
        title={project.title}
        description={project.description || '这个项目还没有描述。'}
        actions={<StatusPill label={formatStage(project.stage)} tone={stageTone(project.stage)} />}
      />
      <Workbench key={project.id} project={project} />
    </div>
  )
}
