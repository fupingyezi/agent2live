import React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Button,
  EmptyState,
  PageHeader,
  StatusPill,
  SurfaceCard,
  type EmptyProps
} from '@agent2live/design-system'
import { listCharacters } from '@studio/api'
import { queryKeys } from '@studio/api'
import { StudioError } from '@studio/components'
import { StudioLoading } from '@studio/components'
import { formatDateTime } from '@studio/format'

export const CharactersPage: React.FC<EmptyProps> = () => {
  const [searchParams] = useSearchParams()
  const queryText = searchParams.get('q')?.trim().toLocaleLowerCase() ?? ''
  const query = useQuery({
    queryKey: queryKeys.characters,
    queryFn: ({ signal }) => listCharacters(signal)
  })
  const characters = (query.data ?? []).filter((character) => {
    if (!queryText) return true
    return `${character.title} ${character.summary}`.toLocaleLowerCase().includes(queryText)
  })
  const featured = characters[0] ?? null

  return (
    <div className="studio-page">
      <PageHeader
        eyebrow="角色"
        title="角色总览"
        description="每个角色拥有独立的美术项目、提示词和 Live2D 绑定。"
        actions={
          <>
            <Button disabled title="导入模型将在 Live2D 模型库阶段开放">
              导入模型
            </Button>
            <Button asChild>
              <Link to="/characters/new">新建角色</Link>
            </Button>
          </>
        }
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
      {query.isSuccess && query.data.length > 0 && characters.length === 0 ? (
        <EmptyState title="没有匹配的角色" description={`没有找到与“${queryText}”相关的角色。`} />
      ) : null}
      {query.isSuccess && featured ? (
        <>
          <section className="studio-featured-character" data-testid="character-overview-hero">
            <div className="studio-character-art" aria-hidden="true">
              <span>{featured.title.slice(0, 1)}</span>
            </div>
            <div className="studio-featured-copy">
              <div>
                <p className="studio-meta">当前角色 · 最近编辑</p>
                <h2>{featured.title}</h2>
                <p>{featured.summary || '尚未填写简介'}</p>
              </div>
              <div className="studio-featured-status">
                <StatusPill label="立绘" tone="success" />
                <span className="studio-meta">提示词与美术版本可在角色卡片中继续</span>
              </div>
            </div>
            <Button asChild>
              <Link to={`/characters/${encodeURIComponent(featured.id)}`}>进入角色卡片</Link>
            </Button>
          </section>

          <div className="studio-section-heading">
            <h2>全部角色</h2>
            <span className="studio-meta">按最近编辑</span>
          </div>
          <div className="studio-character-grid">
            {characters.map((character) => (
              <SurfaceCard asChild key={character.id}>
                <Link
                  to={`/characters/${encodeURIComponent(character.id)}`}
                  className="studio-character-card"
                  data-testid="character-card"
                  data-character-id={character.id}
                >
                  <div className="studio-character-thumb" aria-hidden="true">
                    <span>{character.title.slice(0, 1)}</span>
                  </div>
                  <div className="studio-card-row">
                    <h2 className="studio-card-title">{character.title}</h2>
                    <span className="studio-card-arrow" aria-hidden="true">
                      →
                    </span>
                  </div>
                  <p className="studio-card-copy">{character.summary || '尚未填写简介'}</p>
                  <div className="studio-stage-mini">
                    <span data-state="complete">立绘</span>
                    <span data-state="upcoming">分层</span>
                    <span data-state="upcoming">绑定</span>
                  </div>
                  <p className="studio-meta">更新于 {formatDateTime(character.updatedAt)}</p>
                </Link>
              </SurfaceCard>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
