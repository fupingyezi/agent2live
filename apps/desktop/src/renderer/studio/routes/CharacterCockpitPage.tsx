import React, { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AsyncButton,
  Button,
  Field,
  InlineNotice,
  StatusPill,
  Textarea,
  TextField,
  type EmptyProps
} from '@agent2live/design-system'
import {
  ApiError,
  createArtProject,
  getCharacter,
  getCharacterLineage,
  getPromptWorkspace,
  listArtVersions,
  queryKeys
} from '@studio/api'
import type { ArtProjectDto, CreateArtProjectInput, LineageNodeDto } from '@studio/api'
import { CharacterBackupPanel, StudioError, StudioLoading } from '@studio/components'
import { formatDateTime, formatPercent } from '@studio/format'
import { useAssetUrl } from '@studio/hooks'
import { computeProjectProgress } from '@studio/project-progress'

interface ProjectRow {
  project: ArtProjectDto
  branchLabel: string | null
  parentDeleted: boolean
}

interface CockpitAvatarProps {
  assetId: string | null
  title: string
}

const CockpitAvatar: React.FC<CockpitAvatarProps> = ({ assetId, title }) => {
  const { url } = useAssetUrl(assetId)
  return (
    <div className="cockpit-avatar">
      {url ? <img src={url} alt={`${title} 主立绘`} /> : <span aria-hidden="true" />}
    </div>
  )
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
  const versionsQuery = useQuery({
    queryKey: queryKeys.artVersions(primaryProject?.id ?? 'none'),
    queryFn: ({ signal }) => listArtVersions(primaryProject!.id, signal),
    enabled: Boolean(primaryProject)
  })
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
        <StudioLoading label="正在加载角色卡片…" />
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

  const character = characterQuery.data
  const workspace = workspaceQuery.data
  const versions = versionsQuery.data ?? []
  const activeArtVersion =
    (primaryProject?.activeVersionId
      ? versions.find((version) => version.id === primaryProject.activeVersionId)
      : null) ?? null
  const activeArtAssetId = activeArtVersion?.artworkAssetId ?? null
  const referenceCount = workspace?.latestSubmission?.materials.length ?? 0
  const promptVersionCount = workspace?.versions.length ?? 0
  const justCreated =
    primaryProject?.activeVersionId === null &&
    workspace?.latestSubmission !== null &&
    workspace?.activePromptVersion !== null
  const progress = primaryProject ? computeProjectProgress(primaryProject) : null
  const workbenchPath = primaryProject
    ? `/characters/${encodeURIComponent(id)}/art?project=${encodeURIComponent(primaryProject.id)}`
    : null
  const live2dPath = primaryProject
    ? `/characters/${encodeURIComponent(id)}/live2d?project=${encodeURIComponent(primaryProject.id)}`
    : `/characters/${encodeURIComponent(id)}/live2d`
  const statusLabel = justCreated
    ? '刚创建'
    : activeArtVersion
      ? `已存 v${activeArtVersion.versionNumber}`
      : '进行中'

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
    mutation.mutate(
      description.trim() ? { title: cleanTitle, description: description.trim() } : { title: cleanTitle }
    )
  }

  const mutationError = mutation.error instanceof ApiError ? mutation.error.message : null
  const mutationErrorCode = mutation.error instanceof ApiError ? mutation.error.code : null

  return (
    <div className="studio-page studio-role-card">
      <header className="role-card-header">
        <div className="role-card-identity">
          <CockpitAvatar assetId={activeArtAssetId} title={character.title} />
          <div>
            <h1>{character.title}</h1>
            <div className="role-card-status">
              <StatusPill
                label={statusLabel}
                tone={justCreated ? 'warning' : activeArtVersion ? 'success' : 'neutral'}
              />
              <span>
                {justCreated
                  ? `提示词 v${workspace?.activePromptVersion?.versionNumber ?? 1}，参考图 ${referenceCount} 张`
                  : '最近编辑'}
              </span>
            </div>
          </div>
        </div>
        <div className="role-card-actions">
          <Button asChild variant="secondary">
            <Link to={workbenchPath ?? '#'}>编辑设定</Link>
          </Button>
          <Button asChild>
            <Link to={workbenchPath ?? '#'} data-testid="open-art-workbench" aria-disabled={!workbenchPath}>
              {activeArtVersion ? '继续创作' : '出第一张立绘'}
            </Link>
          </Button>
        </div>
      </header>

      <section className="role-card-stages">
        <article
          className="role-stage-card"
          data-state="current"
          {...(justCreated ? { 'data-testid': 'character-just-created' } : {})}
        >
          <header>
            <strong>立绘</strong>
            <StatusPill label={statusLabel} tone={justCreated ? 'warning' : 'success'} />
          </header>
          <h2 {...(justCreated ? { 'data-testid': 'character-artwork-empty' } : {})}>
            {justCreated ? '提示词写好，还没有出图' : '从候选里挑出可用版本'}
          </h2>
          <p {...(justCreated ? { 'data-testid': 'character-draft-status' } : {})}>
            {justCreated
              ? `${referenceCount} 张参考图 · 提示词版本已保存`
              : progress
                ? `${formatPercent(progress.percent)} · ${progress.nextLabel}`
                : '继续完善提示词与参考图'}
          </p>
          {workbenchPath ? (
            <Link to={workbenchPath}>{justCreated ? '去出立绘' : '打开立绘工作台'}</Link>
          ) : null}
        </article>
        <article className="role-stage-card" data-state="waiting">
          <header>
            <strong>分层与绑定</strong>
            <StatusPill label="等立绘" tone="neutral" />
          </header>
          <h2>{justCreated ? '等立绘定下来' : '等待立绘完成'}</h2>
          <p>立绘出图后解锁</p>
        </article>
        <article className="role-stage-card" data-state="upcoming">
          <header>
            <strong>桌宠</strong>
            <StatusPill label="未开始" tone="neutral" />
          </header>
          <h2>等绑定完成</h2>
          <p>绑定完成后可用</p>
        </article>
      </section>

      <div className="role-card-body">
        <section className="role-lineage-card">
          <header>
            <div>
              <strong>项目谱系</strong>
              <span>{primaryProject ? `每步支持单独回退 · ${primaryProject.title}` : '还没有美术项目'}</span>
            </div>
            <Link to={workbenchPath ?? '#'}>查看项目</Link>
          </header>

          <div className="role-pipeline">
            {[
              { name: '立绘', value: activeArtVersion ? `v${activeArtVersion.versionNumber}` : '未生成' },
              { name: '分层', value: '未生成' },
              { name: '绑定', value: '未生成' },
              { name: '模型', value: '待构建' }
            ].map((step, index) => (
              <React.Fragment key={step.name}>
                <div className="role-pipeline-step" data-state={index === 0 ? 'current' : 'upcoming'}>
                  <span>{step.name}</span>
                  <strong>{step.value}</strong>
                  <small>{index === 0 ? (activeArtVersion ? '已完成' : '等出图') : '等待前一步'}</small>
                </div>
                {index < 3 ? <span className="role-pipeline-arrow">›</span> : null}
              </React.Fragment>
            ))}
          </div>

          <div className="role-history">
            <div>
              <time>{justCreated ? '刚刚' : formatDateTime(character.updatedAt)}</time>
              <span>保存角色版本</span>
              <em>版本</em>
            </div>
            <div>
              <time>
                {justCreated ? '刚刚' : formatDateTime(primaryProject?.createdAt ?? character.updatedAt)}
              </time>
              <span>{`标好 ${referenceCount} 张参考图用途`}</span>
              <em>版本</em>
            </div>
            <div>
              <time>{justCreated ? '刚刚' : formatDateTime(character.createdAt)}</time>
              <span>写完初始化提示词</span>
              <em>版本</em>
            </div>
          </div>
          <div
            className="role-progress-track"
            role="progressbar"
            aria-label={`${character.title} Phase 1 进度`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress?.percent ?? 0}
            data-testid="art-progress"
          >
            <span style={{ width: `${progress?.percent ?? 0}%` }} />
          </div>
        </section>

        <aside className="role-current-card">
          <header>
            <strong>在用</strong>
            <Link to={workbenchPath ?? '#'}>查看全部</Link>
          </header>
          <dl>
            <div>
              <dt>立绘</dt>
              <dd>{activeArtVersion ? `v${activeArtVersion.versionNumber}` : '未生成'}</dd>
            </div>
            <div>
              <dt>分层</dt>
              <dd>未生成</dd>
            </div>
            <div>
              <dt>绑定</dt>
              <dd>未生成</dd>
            </div>
            <div>
              <dt>模型</dt>
              <dd>待构建</dd>
            </div>
            <div>
              <dt>上次改动</dt>
              <dd>{justCreated ? '刚刚' : formatDateTime(character.updatedAt)}</dd>
            </div>
          </dl>
        </aside>
      </div>

      <section className="role-qc-card">
        <header>
          <strong>{justCreated ? '还没有出图' : '待检查项'}</strong>
          <span>{justCreated ? '零项' : `${promptVersionCount} 个版本`}</span>
        </header>
        {[
          [
            '立绘',
            justCreated ? '提示词与参考图就绪' : '选择一个可用版本',
            justCreated ? '去出图' : '去查看'
          ],
          ['分层', '等立绘定下来', '等出图'],
          ['绑定', '等分层确认', '等分层']
        ].map(([stage, issue, action]) => (
          <div className="role-qc-row" key={stage}>
            <span>{stage}</span>
            <strong>{issue}</strong>
            <Link to={workbenchPath ?? '#'}>{action}</Link>
          </div>
        ))}
      </section>

      <div className="role-next-step">
        <span aria-hidden="true">→</span>
        <strong>{justCreated ? '还没出第一张图' : '继续推进当前立绘'}</strong>
        <Link to={workbenchPath ?? '#'}>{justCreated ? '去出立绘' : '打开工作台'}</Link>
      </div>

      <details className="role-secondary-tools" open>
        <summary>新建其他造型、Live2D 与角色备份</summary>
        <div className="role-secondary-grid">
          <section>
            <h2>可独立演进的造型方向</h2>
            <p className="studio-meta">项目谱系当前有 {rows.length} 个造型方向。</p>
            <div className="role-project-list">
              {rows.map(({ project, branchLabel, parentDeleted }) => {
                const projectProgress = computeProjectProgress(project)
                const artPath = `/characters/${encodeURIComponent(id)}/art?project=${encodeURIComponent(project.id)}`
                const projectLive2dPath = `/characters/${encodeURIComponent(id)}/live2d?project=${encodeURIComponent(project.id)}`
                return (
                  <article
                    className="role-project-row"
                    data-testid="project-card"
                    data-project-id={project.id}
                    data-progress={projectProgress.percent}
                    key={project.id}
                  >
                    <header>
                      <strong>{project.title}</strong>
                      <span>{projectProgress.percent}%</span>
                    </header>
                    <p>{project.description || '尚未填写项目描述'}</p>
                    {branchLabel || parentDeleted ? (
                      <p className="role-project-branch">
                        {branchLabel ? `分支：${branchLabel}` : ''}
                        {parentDeleted ? `${branchLabel ? ' · ' : ''}父分支已删除` : ''}
                      </p>
                    ) : null}
                    <div
                      role="progressbar"
                      aria-label={`${project.title} 完成度`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={projectProgress.percent}
                      data-testid="art-progress"
                      data-percent={projectProgress.percent}
                    >
                      <span style={{ width: `${projectProgress.percent}%` }} />
                    </div>
                    <div className="role-project-row-actions">
                      <Link to={artPath}>打开工作台</Link>
                      <Link to={projectLive2dPath}>Live2D</Link>
                    </div>
                  </article>
                )
              })}
            </div>
            <form className="studio-form" onSubmit={onSubmit} noValidate>
              <Field id="project-title" label="美术项目名称" required>
                <TextField
                  id="project-title"
                  value={title}
                  maxLength={100}
                  placeholder="例如：旅行装"
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
                  rows={2}
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
              {mutationError ? (
                <InlineNotice tone="danger">
                  <span role="alert">{mutationError}</span>
                  {mutationErrorCode ? <span className="studio-meta">（{mutationErrorCode}）</span> : null}
                </InlineNotice>
              ) : null}
              <AsyncButton type="submit" busy={mutation.isPending} busyLabel="创建中…">
                新建造型
              </AsyncButton>
            </form>
          </section>
          <section>
            <h2>后续入口</h2>
            <div className="role-secondary-actions">
              <Button asChild variant="secondary">
                <Link to={live2dPath} data-testid="open-live2d">
                  Live2D 绑定
                </Link>
              </Button>
            </div>
            <CharacterBackupPanel characterId={id} />
          </section>
        </div>
      </details>
    </div>
  )
}
