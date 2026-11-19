import React from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { MaterialRole, PromptInputMaterialDto, PromptSpecV2 } from '@studio/api'
import { getArtProject, getCharacter, getPromptWorkspace, queryKeys } from '@studio/api'
import { StudioPageTopbar, StudioError, StudioLoading } from '@studio/components'
import { Button, InlineNotice, type EmptyProps } from '@agent2live/design-system'
import characterEmptyArt from '@studio/assets/empty-states/character-empty.png'
import { useAssetUrl } from '@studio/hooks'
import styles from './CharacterCreatedPage.module.scss'

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

const ROLE_SHORT_LABELS: Record<MaterialRole, string> = {
  identity_reference: '身份',
  style_reference: '画风',
  outfit_reference: '服装',
  color_reference: '配色',
  background_reference: '背景',
  pose_reference: '姿势',
  sketch: '草图',
  texture: '材质',
  other: '参考'
}

interface CreatedReferenceProps {
  material: PromptInputMaterialDto
}

const CreatedReference: React.FC<CreatedReferenceProps> = ({ material }) => {
  const { url } = useAssetUrl(material.assetId)
  return (
    <figure className={styles['created-reference']!} data-testid="created-reference">
      <div className={styles['created-reference-image']!}>
        {url ? <img src={url} alt={ROLE_LABELS[material.role]} /> : <span aria-hidden="true">…</span>}
        <span className={styles['created-reference-role']!}>{ROLE_SHORT_LABELS[material.role]}</span>
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
    <div className={styles['created-avatar']!} data-character-id={characterId}>
      <img src={url ?? characterEmptyArt} alt={url ? `${title} 主参考图` : '看板娘'} />
    </div>
  )
}

function promptText(state: PromptSpecV2 | undefined, globalNotes: string): string {
  if (state?.fullPrompt.trim()) return state.fullPrompt
  const blocks =
    state?.blocks.map((block) => `${block.label}\n${block.text}`).filter((text) => text.trim()) ?? []
  return [globalNotes.trim(), ...blocks].filter(Boolean).join('\n\n')
}

function creationWarningMessage(warning: string | null): string | null {
  switch (warning) {
    case 'no-text-provider':
      return '没有配置 DeepSeek 文本模型，已保存设定生成的当前版本；可稍后在角色描述中继续优化。'
    case 'text-optimize-failed':
      return '文本优化未完成，已保存可编辑的角色设定和提示词版本。'
    case 'no-vision-provider':
      return '没有配置支持视觉输入的聊天连接，参考图反推没有启动；参考图仍已保存。'
    case 'vision-start-failed':
      return '参考图反推未能启动，参考图仍已保存，可在角色描述中重试。'
    default:
      return null
  }
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
  const promptTextValue = promptText(workspace.activePromptVersion?.state, submission?.globalNotes ?? '')
  const workbenchQuery = new URLSearchParams({ project: project.id })
  const aiWarning = searchParams.get('aiWarning')
  const textWarning = searchParams.get('textWarning')
  if (textWarning) workbenchQuery.set('textWarning', textWarning)
  if (aiWarning) workbenchQuery.set('aiWarning', aiWarning)
  const aiKind = searchParams.get('aiKind')
  const aiJob = searchParams.get('aiJob')
  if (aiKind === 'reverse' && aiJob) {
    workbenchQuery.set('aiKind', aiKind)
    workbenchQuery.set('aiJob', aiJob)
  }
  const workbenchPath = `/characters/${encodeURIComponent(id)}/art?${workbenchQuery.toString()}`
  const textWarningMessage = creationWarningMessage(textWarning)
  const aiWarningMessage = creationWarningMessage(aiWarning)

  return (
    <div className="studio-page-frame" data-testid="character-created">
      <StudioPageTopbar
        breadcrumb="角色新建完成"
        tone="completion"
        status={
          <span className={styles['created-topbar-status']!}>
            版本 v{workspace.activePromptVersion?.versionNumber ?? 1} 已创建
          </span>
        }
      />

      <main className={styles['created-page']!}>
        <h1>角色已创建</h1>
        {textWarningMessage || aiWarningMessage ? (
          <div className="created-ai-warning-stack">
            {textWarningMessage ? (
              <div data-testid="text-warning">
                <InlineNotice tone="warning">{textWarningMessage}</InlineNotice>
              </div>
            ) : null}
            {aiWarningMessage ? (
              <div data-testid="ai-warning">
                <InlineNotice tone="warning">{aiWarningMessage}</InlineNotice>
              </div>
            ) : null}
          </div>
        ) : null}
        <section className={styles['created-result-card']!}>
          <header>
            <strong>创建结果</strong>
            <span>v{workspace.activePromptVersion?.versionNumber ?? 1}</span>
          </header>

          <div className={styles['created-summary-card']!} data-testid="character-created-summary">
            <CreatedAvatar characterId={character.id} assetId={primaryAssetId} title={character.title} />
            <div className={styles['created-summary-copy']!}>
              <h2>{character.title}</h2>
              <p>{character.summary || '还没有填写角色简介。'}</p>
            </div>
          </div>

          <section
            className={styles['created-references-section']!}
            data-testid="character-created-references"
          >
            <h2>参考图</h2>
            {materials.length > 0 ? (
              <div className={styles['created-reference-grid']!}>
                {materials.map((material) => (
                  <CreatedReference key={material.id} material={material} />
                ))}
              </div>
            ) : (
              <p className={styles['created-empty-copy']!}>这次只用文字设定开始，没有上传参考图。</p>
            )}
          </section>

          <section className={styles['created-prompt-panel']!} data-testid="created-prompt-panel">
            <h2>初始化提示词</h2>
            <div className={styles['created-prompt']!} data-testid="character-created-prompt">
              <pre>{promptTextValue || '初始化提示词为空。'}</pre>
            </div>
          </section>

          <div className={styles['created-draft-note']!}>
            <span>设定与参考图已保存为当前版本，进入角色卡片后开始出立绘</span>
            <span>{materials.length} 张 · 用途已标注</span>
          </div>

          <footer className={styles['created-footer']!}>
            <div className={styles['created-actions']!}>
              <Button asChild>
                <Link to={`/characters/${encodeURIComponent(id)}`} data-testid="open-character-card">
                  角色卡片
                </Link>
              </Button>
              <Button asChild variant="secondary">
                <Link to={workbenchPath} data-testid="open-art-workbench">
                  立绘管理
                </Link>
              </Button>
            </div>
          </footer>
        </section>
      </main>
    </div>
  )
}
