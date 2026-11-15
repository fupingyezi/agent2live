import React from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { MaterialRole, PromptInputMaterialDto, PromptSpecV2 } from '@studio/api'
import { getArtProject, getCharacter, getPromptWorkspace, queryKeys } from '@studio/api'
import { StudioPageTopbar, StudioError, StudioLoading } from '@studio/components'
import { Button, SectionHeader, StatusPill, type EmptyProps } from '@agent2live/design-system'
import characterEmptyArt from '@studio/assets/empty-states/character-empty.png'
import { useAssetUrl } from '@studio/hooks'

const ROLE_LABELS: Record<MaterialRole, string> = {
  identity_reference: '身份参考',
  style_reference: '风格参考',
  outfit_reference: '服装参考',
  color_reference: '配色参考',
  background_reference: '背景参考',
  pose_reference: '姿态参考',
  sketch: '草图',
  texture: '材质',
  other: '补充参考'
}

interface CreatedReferenceProps {
  material: PromptInputMaterialDto
}

const CreatedReference: React.FC<CreatedReferenceProps> = ({ material }) => {
  const { url } = useAssetUrl(material.assetId)
  return (
    <figure className="created-reference" data-testid="created-reference">
      <div className="created-reference-image">
        {url ? <img src={url} alt={ROLE_LABELS[material.role]} /> : <span aria-hidden="true">…</span>}
      </div>
      <figcaption>
        <strong>{ROLE_LABELS[material.role]}</strong>
        <span>{material.note}</span>
      </figcaption>
    </figure>
  )
}

interface CreatedAvatarProps {
  characterId: string
  assetId: string | null
  title: string
}

const CreatedAvatar: React.FC<CreatedAvatarProps> = ({ characterId, assetId, title }) => {
  const { url } = useAssetUrl(assetId)
  return (
    <div className="created-avatar" data-character-id={characterId}>
      <img src={url ?? characterEmptyArt} alt={url ? `${title} 主参考图` : '看板娘'} />
    </div>
  )
}

function promptText(state: PromptSpecV2 | undefined, globalNotes: string): string {
  const blocks =
    state?.blocks.map((block) => `${block.label}\n${block.text}`).filter((text) => text.trim()) ?? []
  return [globalNotes.trim(), ...blocks].filter(Boolean).join('\n\n')
}

export const CharacterCreatedPage: React.FC<EmptyProps> = () => {
  const { characterId } = useParams<{ characterId: string }>()
  const [searchParams] = useSearchParams()
  const id = characterId ?? ''
  const projectId = searchParams.get('project') ?? ''

  const characterQuery = useQuery({
    queryKey: queryKeys.character(id),
    queryFn: ({ signal }) => getCharacter(id, signal),
    enabled: Boolean(id)
  })
  const projectQuery = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: ({ signal }) => getArtProject(projectId, signal),
    enabled: Boolean(projectId)
  })
  const workspaceQuery = useQuery({
    queryKey: queryKeys.workspace(projectId),
    queryFn: ({ signal }) => getPromptWorkspace(projectId, signal),
    enabled: Boolean(projectId)
  })

  if (!characterId || !projectId) {
    return <Navigate to={id ? `/characters/${encodeURIComponent(id)}` : '/'} replace />
  }

  if (characterQuery.isPending || projectQuery.isPending || workspaceQuery.isPending) {
    return (
      <div className="studio-page">
        <StudioLoading label="正在整理创建结果…" />
      </div>
    )
  }
  const error = characterQuery.error ?? projectQuery.error ?? workspaceQuery.error
  if (error) {
    return (
      <div className="studio-page">
        <StudioError
          error={error}
          onRetry={() => {
            void characterQuery.refetch()
            void projectQuery.refetch()
            void workspaceQuery.refetch()
          }}
        />
      </div>
    )
  }
  if (!characterQuery.data || !projectQuery.data || !workspaceQuery.data) {
    return (
      <div className="studio-page">
        <StudioLoading label="正在整理创建结果…" />
      </div>
    )
  }

  const character = characterQuery.data
  const project = projectQuery.data
  const workspace = workspaceQuery.data
  const submission = workspace.latestSubmission
  const materials = [...(submission?.materials ?? [])].sort((left, right) => left.sortOrder - right.sortOrder)
  const primaryAssetId = materials[0]?.assetId ?? null
  const draftText = promptText(workspace.activeDraft?.state, submission?.globalNotes ?? '')
  const workbenchQuery = new URLSearchParams({ project: project.id })
  const aiWarning = searchParams.get('aiWarning')
  if (aiWarning) workbenchQuery.set('aiWarning', aiWarning)
  const aiKind = searchParams.get('aiKind')
  const aiJob = searchParams.get('aiJob')
  if (aiKind === 'reverse' && aiJob) {
    workbenchQuery.set('aiKind', aiKind)
    workbenchQuery.set('aiJob', aiJob)
  }
  const workbenchPath = `/characters/${encodeURIComponent(id)}/art?${workbenchQuery.toString()}`

  return (
    <div className="studio-page-frame" data-testid="character-created">
      <StudioPageTopbar
        breadcrumb="角色新建完成"
        tone="completion"
        status={<StatusPill label="草稿已自动保存" tone="success" />}
      />

      <main className="created-page">
        <div className="created-page-heading">
          <span>创建完成</span>
          <h1>{character.title} 已准备好</h1>
          <p>{project.title} 和初始化提示词草稿已经建立。</p>
        </div>

        <section className="created-summary-card" data-testid="character-created-summary">
          <CreatedAvatar characterId={character.id} assetId={primaryAssetId} title={character.title} />
          <div className="created-summary-copy">
            <span className="studio-meta">角色 · 最近创建</span>
            <h2>{character.title}</h2>
            <p>{character.summary || '还没有填写角色简介。'}</p>
            <div className="created-summary-meta">
              <StatusPill label="草稿已自动保存" tone="success" />
              <span>
                {materials.length} 张参考图 · 默认项目“{project.title}”
              </span>
            </div>
          </div>
        </section>

        <div className="created-layout">
          <section className="created-panel" data-testid="character-created-references">
            <SectionHeader
              title="参考图"
              description="这些参考已经写入初始化提示词。"
              actions={<span className="studio-meta">{materials.length} 张</span>}
            />
            {materials.length > 0 ? (
              <div className="created-reference-grid">
                {materials.map((material) => (
                  <CreatedReference key={material.id} material={material} />
                ))}
              </div>
            ) : (
              <p className="created-empty-copy">这次只用文字设定开始，没有上传参考图。</p>
            )}
          </section>

          <section className="created-panel created-prompt-panel">
            <SectionHeader title="初始化提示词" description="草稿可以从这里继续调整。" />
            <div className="created-prompt" data-testid="character-created-prompt">
              <pre>{draftText || '初始化提示词为空。'}</pre>
            </div>
          </section>
        </div>

        <footer className="created-footer">
          <div>
            <strong>草稿已自动保存</strong>
            <span className="studio-meta">
              {materials.length} 张参考图 · 项目“{project.title}”
            </span>
          </div>
          <div className="created-actions">
            <Button asChild variant="secondary">
              <Link to={workbenchPath} data-testid="open-art-workbench">
                立绘管理
              </Link>
            </Button>
            <Button asChild>
              <Link to={`/characters/${encodeURIComponent(id)}`} data-testid="open-character-card">
                角色卡片
              </Link>
            </Button>
          </div>
        </footer>
      </main>
    </div>
  )
}
