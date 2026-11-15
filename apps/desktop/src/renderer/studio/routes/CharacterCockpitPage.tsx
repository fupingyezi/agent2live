import React, { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AsyncButton,
  Button,
  CountBadge,
  EmptyState,
  Field,
  InlineNotice,
  PageHeader,
  SectionHeader,
  StatusPill,
  SurfaceCard,
  Tag,
  Textarea,
  TextField,
  type EmptyProps
} from '@agent2live/design-system'
import { ApiError } from '@studio/api'
import { createArtProject, getCharacter, getCharacterLineage, getPromptWorkspace } from '@studio/api'
import { queryKeys } from '@studio/api'
import type { ArtProjectDto, CreateArtProjectInput, LineageNodeDto } from '@studio/api'
import { CharacterBackupPanel } from '@studio/components'
import { StudioError } from '@studio/components'
import { StudioLoading } from '@studio/components'
import { formatDateTime, formatPercent, formatStage, stageTone } from '@studio/format'
import { computeProjectProgress } from '@studio/project-progress'

interface ProjectRow {
  project: ArtProjectDto
  branchLabel: string | null
  parentDeleted: boolean
}

function flattenRows(roots: LineageNodeDto[]): ProjectRow[] {
  const rows: ProjectRow[] = []
  const seen = new Set<string>()
  const visit = (node: LineageNodeDto): void => {
    if (seen.has(node.project.id)) return
    seen.add(node.project.id)
    rows.push({
      project: node.project,
      branchLabel: node.fork?.branchLabel ?? null,
      parentDeleted: node.parentDeleted
    })
    for (const child of node.children) visit(child)
  }
  for (const root of roots) visit(root)
  return rows
}

export const CharacterCockpitPage: React.FC<EmptyProps> = () => {
  const { characterId } = useParams<{ characterId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const id = characterId ?? ''
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const characterQuery = useQuery({
    queryKey: queryKeys.character(id),
    queryFn: ({ signal }) => getCharacter(id, signal),
    enabled: Boolean(id)
  })
  const lineageQuery = useQuery({
    queryKey: queryKeys.lineage(id),
    queryFn: ({ signal }) => getCharacterLineage(id, signal),
    enabled: Boolean(id)
  })

  const rows = useMemo(() => flattenRows(lineageQuery.data?.roots ?? []), [lineageQuery.data])
  const primaryProject = rows[0]?.project ?? null
  const workspaceQuery = useQuery({
    queryKey: queryKeys.workspace(primaryProject?.id ?? 'none'),
    queryFn: ({ signal }) => getPromptWorkspace(primaryProject!.id, signal),
    enabled: Boolean(primaryProject)
  })
  // The lineage endpoint reports a character with no projects as 404; the character
  // query already proves existence, so that response means an empty project list.
  const lineageMissing = lineageQuery.error instanceof ApiError && lineageQuery.error.status === 404

  const mutation = useMutation({
    mutationFn: (input: CreateArtProjectInput) => {
      if (!id) return Promise.reject(new Error('character id is missing'))
      return createArtProject(id, input)
    },
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.lineage(id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.characters })
      navigate(`/characters/${encodeURIComponent(id)}/art?project=${encodeURIComponent(project.id)}`)
    }
  })

  if (!characterId) return <Navigate to="/" replace />

  if (characterQuery.isPending || lineageQuery.isPending) {
    return (
      <div className="studio-page">
        <StudioLoading label="正在加载角色驾驶舱…" />
      </div>
    )
  }
  if (characterQuery.isError) {
    return (
      <div className="studio-page">
        <StudioError
          error={characterQuery.error}
          onRetry={() => {
            void characterQuery.refetch()
          }}
        />
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

  const clearFailure = (): void => {
    setLocalError(null)
    if (mutation.isError) mutation.reset()
  }

  const onSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setLocalError('请输入美术项目名称。')
      return
    }
    if (cleanTitle.length > 100) {
      setLocalError('美术项目名称不能超过 100 个字符。')
      return
    }
    if (description.trim().length > 4000) {
      setLocalError('描述不能超过 4000 个字符。')
      return
    }
    setLocalError(null)
    const cleanDescription = description.trim()
    mutation.mutate(
      cleanDescription ? { title: cleanTitle, description: cleanDescription } : { title: cleanTitle }
    )
  }

  const serverError = mutation.error instanceof ApiError ? mutation.error.message : null
  const errorCode = mutation.error instanceof ApiError ? mutation.error.code : null
  const primaryProgress = primaryProject ? computeProjectProgress(primaryProject) : null
  const primaryWorkspace = primaryProject ? workspaceQuery.data : null
  const justCreated =
    primaryProject?.activeVersionId === null &&
    primaryWorkspace?.latestSubmission !== null &&
    primaryWorkspace?.activeDraft !== null
  const primaryReferenceCount = primaryWorkspace?.latestSubmission?.materials.length ?? 0
  const primaryArtworkPath = primaryProject
    ? `/characters/${encodeURIComponent(id)}/art?project=${encodeURIComponent(primaryProject.id)}`
    : null

  return (
    <div className="studio-page studio-cockpit">
      <PageHeader
        back={
          <Link className="studio-back" to="/">
            ← 返回角色
          </Link>
        }
        eyebrow="角色驾驶舱"
        title={characterQuery.data.title}
        description={characterQuery.data.summary || '这个角色还没有简介。'}
        actions={
          justCreated && primaryArtworkPath ? (
            <>
              <Button asChild variant="secondary">
                <Link to={primaryArtworkPath}>编辑设定</Link>
              </Button>
              <Button asChild>
                <Link to={primaryArtworkPath} data-testid="open-art-workbench">
                  出一张立绘
                </Link>
              </Button>
            </>
          ) : (
            <Button asChild variant="secondary">
              <Link to={`/characters/${encodeURIComponent(id)}/live2d`} data-testid="open-live2d">
                Live2D 绑定
              </Link>
            </Button>
          )
        }
      />

      <section className="studio-cockpit-stages" data-testid="character-stage-overview">
        <article
          className="studio-cockpit-stage"
          data-state={primaryProject ? 'active' : 'upcoming'}
          {...(justCreated ? { 'data-testid': 'character-just-created' } : {})}
        >
          <div>
            <span className="studio-meta">{justCreated ? '立绘 · 刚创建' : '立绘'}</span>
            <h2 {...(justCreated ? { 'data-testid': 'character-artwork-empty' } : {})}>
              {justCreated ? '还没出图' : primaryProject ? `已有 ${primaryProject.title}` : '尚未开始'}
            </h2>
            <p {...(justCreated ? { 'data-testid': 'character-draft-status' } : {})}>
              {justCreated
                ? `${primaryReferenceCount} 张参考图 · 草稿已自动保存`
                : primaryProgress
                  ? `${formatPercent(primaryProgress.percent)} · ${primaryProgress.nextLabel}`
                  : '创建项目后开始提示词与候选版本。'}
            </p>
          </div>
          {primaryProject ? (
            <Button asChild variant="secondary" size="sm">
              <Link to={primaryArtworkPath!}>{justCreated ? '继续编辑提示词' : '打开立绘工作台'}</Link>
            </Button>
          ) : null}
        </article>
        <article className="studio-cockpit-stage" data-state="upcoming">
          <div>
            <span className="studio-meta">分层与绑定</span>
            <h2>等待立绘版本</h2>
            <p>Phase 2 将接入 PSD 分层、绑定与质检。</p>
          </div>
          <StatusPill label="未开始" tone="neutral" />
        </article>
        <article className="studio-cockpit-stage" data-state="upcoming">
          <div>
            <span className="studio-meta">桌宠</span>
            <h2>等待可用模型</h2>
            <p>只有通过质检并发布的模型才能进入桌宠。</p>
          </div>
          <StatusPill label="未开始" tone="neutral" />
        </article>
      </section>

      <div className="studio-cockpit-grid">
        <section className="studio-cockpit-main">
          <SectionHeader
            title="美术项目"
            description="每个项目对应一个可独立演进的造型方向。"
            actions={<CountBadge value={rows.length} />}
          />
          {rows.length === 0 ? (
            <div data-testid="lineage-empty">
              <EmptyState
                icon="◇"
                title="还没有美术项目"
                description="在右侧创建第一个项目，再从提示词和素材开始构建造型。"
              />
            </div>
          ) : (
            <div className="studio-project-list">
              {rows.map(({ project, branchLabel, parentDeleted }) => {
                const progress = computeProjectProgress(project)
                const artPath = `/characters/${encodeURIComponent(project.characterId)}/art?project=${encodeURIComponent(project.id)}`
                const live2dPath = `/characters/${encodeURIComponent(project.characterId)}/live2d?project=${encodeURIComponent(project.id)}`
                return (
                  <SurfaceCard key={project.id} asChild>
                    <article
                      className="studio-project-card"
                      data-testid="project-card"
                      data-project-id={project.id}
                      data-progress={progress.percent}
                    >
                      <div className="studio-card-row">
                        <h3 className="studio-card-title">
                          <Link className="studio-project-title-link" to={artPath}>
                            {project.title}
                          </Link>
                        </h3>
                        <StatusPill label={formatStage(project.stage)} tone={stageTone(project.stage)} />
                      </div>
                      <p className="studio-card-copy">{project.description || '尚未填写项目描述'}</p>
                      <div className="studio-meta-row">
                        <span className="studio-meta">更新于 {formatDateTime(project.updatedAt)}</span>
                        {branchLabel ? <Tag>分支：{branchLabel}</Tag> : null}
                        {parentDeleted ? <Tag>父分支已删除</Tag> : null}
                      </div>
                      <div className="studio-progress-block">
                        <div className="studio-progress-caption">
                          <span>Phase 1 进度</span>
                          <span>
                            {formatPercent(progress.percent)} · {progress.nextLabel}
                          </span>
                        </div>
                        <div
                          className="studio-progress-track"
                          role="progressbar"
                          aria-label={`${project.title} 完成度`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={progress.percent}
                          data-testid="art-progress"
                          data-percent={progress.percent}
                        >
                          <span className="studio-progress-fill" style={{ width: `${progress.percent}%` }} />
                        </div>
                      </div>
                      <div className="studio-project-actions">
                        <Button asChild variant="secondary" size="sm">
                          <Link to={artPath}>打开工作台</Link>
                        </Button>
                        <Button asChild variant="quiet" size="sm">
                          <Link to={live2dPath}>Live2D</Link>
                        </Button>
                      </div>
                    </article>
                  </SurfaceCard>
                )
              })}
            </div>
          )}
        </section>

        <aside className="studio-cockpit-aside">
          <SurfaceCard title="新建美术项目" description="一个项目对应一个可独立演进的造型方向。">
            <form className="studio-form" onSubmit={onSubmit} noValidate>
              <Field id="project-title" label="项目名称" required>
                <TextField
                  id="project-title"
                  value={title}
                  maxLength={100}
                  placeholder="例如：默认造型"
                  onValueChange={(value) => {
                    setTitle(value)
                    clearFailure()
                  }}
                />
              </Field>
              <Field id="project-description" label="描述（可选）">
                <Textarea
                  id="project-description"
                  value={description}
                  maxLength={4000}
                  rows={3}
                  placeholder="方向、用途或限制"
                  onValueChange={(value) => {
                    setDescription(value)
                    clearFailure()
                  }}
                />
              </Field>
              {localError ? (
                <InlineNotice tone="danger">
                  <span role="alert">{localError}</span>
                </InlineNotice>
              ) : null}
              {serverError ? (
                <InlineNotice tone="danger">
                  <span role="alert">{serverError}</span>
                  {errorCode ? <span className="studio-meta">（{errorCode}）</span> : null}
                </InlineNotice>
              ) : null}
              <AsyncButton type="submit" busy={mutation.isPending} busyLabel="创建中…">
                创建项目
              </AsyncButton>
            </form>
          </SurfaceCard>
          <CharacterBackupPanel characterId={id} />
        </aside>
      </div>
    </div>
  )
}
