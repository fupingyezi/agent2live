import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, EmptyState, PageHeader, SurfaceCard, type EmptyProps } from '@agent2live/design-system'
import { listCharacters } from '@studio/api'
import { queryKeys } from '@studio/api'
import { StudioError } from '@studio/components'
import { StudioLoading } from '@studio/components'
import { formatDateTime } from '@studio/format'

export const CharactersPage: React.FC<EmptyProps> = () => {
  const query = useQuery({
    queryKey: queryKeys.characters,
    queryFn: ({ signal }) => listCharacters(signal)
  })

  return (
    <div className="studio-page">
      <PageHeader
        eyebrow="Studio"
        title="角色"
        description="每个角色拥有独立的美术项目、提示词和 Live2D 绑定。"
      />

      {query.isPending ? <StudioLoading label="正在加载角色…" /> : null}
      {query.isError ? (
        <StudioError
          error={query.error}
          onRetry={() => {
            void query.refetch()
          }}
        />
      ) : null}
      {query.isSuccess && query.data.length === 0 ? (
        <EmptyState
          icon="◇"
          title="还没有角色"
          description="从一个角色开始，建立提示词、美术版本与未来 Live2D 模型的完整链路。"
          action={
            <Button asChild>
              <Link to="/characters/new">创建第一个角色</Link>
            </Button>
          }
        />
      ) : null}
      {query.isSuccess && query.data.length > 0 ? (
        <div className="studio-character-grid">
          {query.data.map((character) => (
            <SurfaceCard asChild key={character.id}>
              <Link
                to={`/characters/${encodeURIComponent(character.id)}`}
                className="studio-character-card"
                data-testid="character-card"
                data-character-id={character.id}
              >
                <div className="studio-card-row">
                  <h2 className="studio-card-title">{character.title}</h2>
                  <span className="studio-card-arrow" aria-hidden="true">
                    →
                  </span>
                </div>
                <p className="studio-card-copy">{character.summary || '尚未填写简介'}</p>
                <p className="studio-meta">更新于 {formatDateTime(character.updatedAt)}</p>
              </Link>
            </SurfaceCard>
          ))}
        </div>
      ) : null}
    </div>
  )
}
