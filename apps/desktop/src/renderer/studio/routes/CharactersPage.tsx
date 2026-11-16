import React, { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  InlineNotice,
  SearchField,
  StatusPill,
  SurfaceCard,
  type EmptyProps
} from '@agent2live/design-system'
import {
  ApiError,
  deleteCharacter,
  flattenLineage,
  getCharacterLineage,
  listArtVersions,
  listCharacters,
  queryKeys
} from '@studio/api'
import type { ArtProjectDto, ArtVersionDto, CharacterDto } from '@studio/api'
import { StudioError, StudioPageTopbar } from '@studio/components'
import { StudioLoading } from '@studio/components'
import { formatDateTime, formatPercent } from '@studio/format'
import { useAssetUrl } from '@studio/hooks'
import { computeProjectProgress } from '@studio/project-progress'
import characterEmptyArt from '@studio/assets/empty-states/character-empty.png'

interface CharacterOverviewItem {
  character: CharacterDto
  project: ArtProjectDto | null
  activeArtVersion: ArtVersionDto | null
  primaryAssetId: string | null
}

interface CharacterOverviewArtProps {
  title: string
  assetId: string | null
  variant: 'hero' | 'card'
}

interface CharacterOverviewStagesProps {
  ready: boolean
}

const CharacterOverviewArt: React.FC<CharacterOverviewArtProps> = ({ title, assetId, variant }) => {
  const { url } = useAssetUrl(assetId)
  const className = variant === 'hero' ? 'studio-character-art' : 'studio-character-thumb'
  return (
    <div className={className} data-state={url ? 'ready' : 'empty'}>
      {url && assetId ? (
        <img src={url} alt={`${title} 主参考图`} data-asset-id={assetId} />
      ) : (
        <img src={characterEmptyArt} alt="等待立绘的看板娘" data-empty-state="mascot" />
      )}
    </div>
  )
}

const CharacterOverviewStages: React.FC<CharacterOverviewStagesProps> = ({ ready }) => (
  <div className="studio-overview-stages" aria-label="角色阶段">
    <span data-state={ready ? 'complete' : 'upcoming'}>立绘</span>
    <span data-state="upcoming">分层</span>
    <span data-state="upcoming">绑定</span>
  </div>
)

function characterProjectStatus(item: CharacterOverviewItem): {
  label: string
  tone: 'neutral' | 'success' | 'warning'
} {
  if (!item.project) return { label: '尚未开始', tone: 'neutral' }
  if (!item.activeArtVersion) return { label: '待出图', tone: 'warning' }
  return { label: '已出立绘', tone: 'success' }
}

export const CharactersPage: React.FC<EmptyProps> = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [pendingDelete, setPendingDelete] = useState<CharacterDto | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const queryText = (searchParams.get('q') ?? '').trim().toLocaleLowerCase()
  const query = useQuery({
    queryKey: queryKeys.characters,
    queryFn: ({ signal }) => listCharacters(signal)
  })
  const characters = (query.data ?? []).filter((character) => {
    if (!queryText) return true
    return `${character.title} ${character.summary}`.toLocaleLowerCase().includes(queryText)
  })
  const lineageQueries = useQueries({
    queries: characters.map((character) => ({
      queryKey: queryKeys.lineage(character.id),
      queryFn: ({ signal }: { signal: AbortSignal }) => getCharacterLineage(character.id, signal),
      enabled: query.isSuccess,
      retry: (failureCount: number, error: Error) => {
        if (error instanceof ApiError && error.status === 404) return false
        return failureCount < 2
      }
    }))
  })
  const projects = characters.map((_character, index) => {
    const lineage = lineageQueries[index]?.data
    return lineage ? (flattenLineage(lineage.roots)[0] ?? null) : null
  })
  const versionQueries = useQueries({
    queries: characters.map((character, index) => {
      const project = projects[index] ?? null
      return {
        queryKey: project
          ? queryKeys.artVersions(project.id)
          : (['projects', 'none', 'art-versions', character.id] as const),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          project ? listArtVersions(project.id, signal) : Promise.resolve([]),
        enabled: Boolean(project)
      }
    })
  })
  const items: CharacterOverviewItem[] = characters.map((character, index) => {
    const project = projects[index] ?? null
    const versions = versionQueries[index]?.data ?? []
    const activeArtVersion =
      (project?.activeVersionId
        ? versions.find((version) => version.id === project.activeVersionId)
        : null) ?? null
    const primaryAssetId =
      activeArtVersion?.references.find((reference) => reference.isPrimary)?.assetId ??
      activeArtVersion?.references[0]?.assetId ??
      null
    return { character, project, activeArtVersion, primaryAssetId }
  })
  const featured = items[0] ?? null
  const overviewLoading =
    query.isPending ||
    lineageQueries.some((lineageQuery) => lineageQuery.isLoading) ||
    versionQueries.some((versionQuery) => versionQuery.isLoading)
  const overviewError =
    lineageQueries.find(
      (lineageQuery) =>
        lineageQuery.error && !(lineageQuery.error instanceof ApiError && lineageQuery.error.status === 404)
    )?.error ??
    versionQueries.find((versionQuery) => versionQuery.error)?.error ??
    query.error

  const retryOverview = (): void => {
    void query.refetch()
    for (const lineageQuery of lineageQueries) void lineageQuery.refetch()
    for (const versionQuery of versionQueries) void versionQuery.refetch()
  }

  const openDelete = (character: CharacterDto): void => {
    setPendingDelete(character)
    setDeleteError(null)
  }

  const closeDelete = (): void => {
    if (deleteBusy) return
    setPendingDelete(null)
  }

  const confirmDelete = (): void => {
    if (!pendingDelete) return
    const characterId = pendingDelete.id
    setDeleteBusy(true)
    setDeleteError(null)
    deleteCharacter(characterId, pendingDelete.rowVersion)
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.character(characterId) })
        void queryClient.invalidateQueries({ queryKey: queryKeys.characters })
        void queryClient.invalidateQueries({ queryKey: queryKeys.lineages })
        void queryClient.invalidateQueries({ queryKey: queryKeys.lineage(characterId) })
        setPendingDelete(null)
      })
      .catch((reason) => {
        setDeleteError(reason instanceof ApiError ? reason.message : String(reason))
      })
      .finally(() => setDeleteBusy(false))
  }

  return (
    <div className="studio-page-frame">
      <StudioPageTopbar
        breadcrumb="角色"
        actions={
          <>
            <form
              className="studio-overview-search"
              role="search"
              onSubmit={(event) => {
                event.preventDefault()
                const query = search.trim()
                navigate(query ? `/?q=${encodeURIComponent(query)}` : '/')
              }}
            >
              <SearchField
                aria-label="搜索角色、项目"
                clearLabel="清空搜索"
                value={search}
                placeholder="搜索角色、项目"
                onValueChange={setSearch}
              />
            </form>
            <span className="studio-overview-avatar" aria-hidden="true" />
          </>
        }
      />
      <div className="studio-page studio-overview-page">
        <header className="studio-overview-header">
          <div>
            <h1>角色总览</h1>
            <p>{query.data?.length ?? 0} 个角色</p>
          </div>
          <div className="studio-overview-header-actions">
            <Button disabled title="导入模型将在 Live2D 模型库阶段开放">
              导入模型
            </Button>
            <Button asChild>
              <Link to="/characters/new">新建角色</Link>
            </Button>
          </div>
        </header>

        {overviewLoading ? <StudioLoading label="正在加载角色总览…" /> : null}
        {overviewError ? <StudioError error={overviewError} onRetry={retryOverview} /> : null}
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
            <section
              className="studio-featured-character"
              data-testid="character-overview-hero"
              data-character-id={featured.character.id}
            >
              <CharacterOverviewArt
                title={featured.character.title}
                assetId={featured.primaryAssetId}
                variant="hero"
              />
              <div className="studio-featured-copy">
                <div>
                  <p className="studio-meta">当前角色 · 最近编辑</p>
                  <h2>{featured.character.title}</h2>
                  <p>{featured.character.summary || '尚未填写简介'}</p>
                </div>
                <div className="studio-featured-status">
                  <CharacterOverviewStages ready={Boolean(featured.activeArtVersion)} />
                  <span className="studio-meta">更新于 {formatDateTime(featured.character.updatedAt)}</span>
                </div>
              </div>
              <div className="studio-featured-action">
                <Button asChild>
                  <Link to={`/characters/${encodeURIComponent(featured.character.id)}`}>进入角色卡片</Link>
                </Button>
              </div>
            </section>

            <div className="studio-section-heading">
              <h2>全部角色</h2>
              <span className="studio-meta">按最近编辑</span>
            </div>
            <div className="studio-character-grid">
              {items.map((item) => {
                const status = characterProjectStatus(item)
                const progress = item.project ? computeProjectProgress(item.project) : null
                return (
                  <div className="studio-character-card-shell" key={item.character.id}>
                    <SurfaceCard asChild>
                      <Link
                        to={`/characters/${encodeURIComponent(item.character.id)}`}
                        className="studio-character-card"
                        data-testid="character-card"
                        data-character-id={item.character.id}
                      >
                        <CharacterOverviewArt
                          title={item.character.title}
                          assetId={item.primaryAssetId}
                          variant="card"
                        />
                        <div className="studio-character-card-body">
                          {item.activeArtVersion ? (
                            <>
                              <div className="studio-card-row">
                                <h2 className="studio-card-title">{item.character.title}</h2>
                                <StatusPill label={status.label} tone={status.tone} />
                              </div>
                              {progress ? (
                                <div className="studio-overview-progress">
                                  <div className="studio-progress-caption">
                                    <span>Phase 1</span>
                                    <span>{formatPercent(progress.percent)}</span>
                                  </div>
                                  <div
                                    className="studio-progress-track"
                                    role="progressbar"
                                    aria-label={`${item.character.title} 完成度`}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={progress.percent}
                                  >
                                    <span
                                      className="studio-progress-fill"
                                      style={{ width: `${progress.percent}%` }}
                                    />
                                  </div>
                                </div>
                              ) : null}
                              <p className="studio-meta">更新于 {formatDateTime(item.character.updatedAt)}</p>
                            </>
                          ) : (
                            <div className="studio-character-empty-copy">
                              <h2>
                                {item.character.title} · {item.project ? '还没有立绘' : '尚未开始'}
                              </h2>
                              <p>「这里还空着呀。」写一句话试试。</p>
                              <span>从一句话开始，不用先准备素材</span>
                            </div>
                          )}
                        </div>
                      </Link>
                    </SurfaceCard>
                    <IconButton
                      type="button"
                      className="studio-character-delete"
                      label={`删除角色 ${item.character.title}`}
                      title={`删除角色「${item.character.title}」`}
                      onClick={() => openDelete(item.character)}
                    >
                      ×
                    </IconButton>
                  </div>
                )
              })}
            </div>

            <ConfirmDialog
              open={pendingDelete !== null}
              title="删除角色？"
              destructive
              confirmLabel="删除"
              busy={deleteBusy}
              onCancel={closeDelete}
              onConfirm={confirmDelete}
            >
              {pendingDelete ? (
                <>
                  <p>
                    「{pendingDelete.title}」及其全部美术项目、提示词与生成记录将一并删除，此操作不能从 UI
                    撤销。
                  </p>
                  {deleteError ? (
                    <div role="alert">
                      <InlineNotice tone="danger">{deleteError}</InlineNotice>
                    </div>
                  ) : null}
                </>
              ) : null}
            </ConfirmDialog>
          </>
        ) : null}
      </div>
    </div>
  )
}
