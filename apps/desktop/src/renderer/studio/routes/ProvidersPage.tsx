import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AsyncButton,
  Button,
  Dialog,
  EmptyState,
  Field,
  InlineNotice,
  PageHeader,
  SectionHeader,
  Select,
  StatusPill,
  SurfaceCard,
  Switch,
  TextField,
  type EmptyProps
} from '@agent2live/design-system'
import { ApiError } from '@studio/api'
import { queryKeys } from '@studio/api'
import { createProvider, getProvider, listProviders, updateProvider } from '@studio/api'
import type { ProviderConnectionDto } from '@studio/api'
import { StudioError } from '@studio/components'
import { StudioLoading } from '@studio/components'
import {
  ProviderActivationError,
  ProviderFormError,
  createProviderFlow,
  updateProviderFlow,
  type ProviderFlowPort
} from '@studio/providers'
import {
  PROVIDER_PRESETS,
  getProviderPreset,
  initialProviderValues,
  presetIdForConnection,
  type ProviderFormValues
} from '@studio/providers'
import { formatDateTime } from '@studio/format'

const ADAPTER_LABELS: Record<ProviderConnectionDto['adapter'], string> = {
  'openai-compatible': 'OpenAI 兼容',
  seedream: 'Seedream',
  mock: 'Mock'
}

const PROVIDER_FORM_ID = 'provider-editor-form'

interface EditorState {
  mode: 'create' | 'edit'
  connection: ProviderConnectionDto | null
  values: ProviderFormValues
}

interface FormFailure {
  message: string
  fields: Partial<Record<'label' | 'baseUrl' | 'model' | 'apiKey', string>>
}

const port: ProviderFlowPort = {
  create: createProvider,
  update: updateProvider,
  get: getProvider,
  storeSecret: (input) => {
    const bridge = window.agent2live
    if (!bridge) return Promise.reject(new Error('agent2live preload bridge is unavailable'))
    return bridge.secrets.store(input)
  }
}

function failureFrom(error: unknown): FormFailure {
  if (error instanceof ProviderFormError) {
    return { message: '请修正表单中的问题。', fields: error.fields }
  }
  if (error instanceof ProviderActivationError) {
    return {
      message: `${error.message}（连接 ID：${error.providerId}）`,
      fields: {}
    }
  }
  if (error instanceof ApiError) {
    return { message: error.message, fields: {} }
  }
  return { message: error instanceof Error ? error.message : '保存失败，请重试。', fields: {} }
}

function defaultEditor(): EditorState {
  const preset = getProviderPreset('openai-chat')
  return { mode: 'create', connection: null, values: initialProviderValues(preset) }
}

export const ProvidersPage: React.FC<EmptyProps> = () => {
  const queryClient = useQueryClient()
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [failure, setFailure] = useState<FormFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)

  const query = useQuery({
    queryKey: queryKeys.providers,
    queryFn: ({ signal }) => listProviders(signal)
  })

  const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: queryKeys.providers })

  const updateField = <K extends keyof ProviderFormValues>(key: K, value: ProviderFormValues[K]): void => {
    setEditor((current) => (current ? { ...current, values: { ...current.values, [key]: value } } : current))
    setFailure(null)
  }

  const startCreate = (): void => {
    setEditor(defaultEditor())
    setFailure(null)
    setPageError(null)
  }

  const startEdit = (connection: ProviderConnectionDto): void => {
    setEditor({
      mode: 'edit',
      connection,
      values: {
        presetId: presetIdForConnection(connection),
        label: connection.label,
        baseUrl: connection.baseUrl ?? '',
        model: connection.model ?? '',
        apiKey: '',
        enabled: connection.enabled
      }
    })
    setFailure(null)
    setPageError(null)
  }

  const closeEditor = (): void => {
    if (saving) return
    setEditor(null)
    setFailure(null)
  }

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!editor || saving) return
    setSaving(true)
    setFailure(null)
    setPageError(null)
    try {
      if (editor.mode === 'create') {
        await createProviderFlow(port, editor.values)
        setNotice('连接已创建。')
      } else if (editor.connection) {
        await updateProviderFlow(port, editor.connection, editor.values)
        setNotice(editor.values.apiKey.trim() ? '连接与密钥已更新。' : '连接已更新。')
      }
      setEditor(null)
      await invalidate()
    } catch (error) {
      setFailure(failureFrom(error))
      if (error instanceof ProviderActivationError) {
        await invalidate().catch(() => undefined)
      }
    } finally {
      setSaving(false)
    }
  }

  const onPresetChange = (presetId: string): void => {
    if (!editor || editor.mode === 'edit') return
    const preset = getProviderPreset(presetId)
    setEditor({ ...editor, values: initialProviderValues(preset) })
    setFailure(null)
  }

  const toggleEnabled = async (connection: ProviderConnectionDto): Promise<void> => {
    if (togglingId) return
    if (connection.adapter !== 'mock' && !connection.enabled && !connection.hasSecret) {
      startEdit(connection)
      return
    }
    setTogglingId(connection.id)
    setPageError(null)
    try {
      await updateProvider(connection.id, { enabled: !connection.enabled }, connection.rowVersion)
      await invalidate()
      setNotice(connection.enabled ? '连接已停用。' : '连接已启用。')
    } catch (error) {
      setPageError(error instanceof ApiError ? error.message : '更新连接状态失败。')
    } finally {
      setTogglingId(null)
    }
  }

  const canToggle = (connection: ProviderConnectionDto): boolean =>
    connection.adapter === 'mock' || connection.hasSecret

  const preset = editor ? getProviderPreset(editor.values.presetId) : null

  return (
    <div className="studio-page providers-page" data-testid="providers-page">
      <PageHeader
        eyebrow="设置"
        title="模型连接"
        description="对话模型用于提示词反推与建议；Seedream 用于立绘候选生成。密钥只保存在本机系统钥匙串。"
        actions={
          <Button data-testid="add-provider" onClick={startCreate}>
            添加连接
          </Button>
        }
      />

      {notice ? (
        <div className="page-notice">
          <InlineNotice tone="success">{notice}</InlineNotice>
        </div>
      ) : null}
      {pageError ? (
        <div className="page-notice" role="alert">
          <InlineNotice tone="danger">{pageError}</InlineNotice>
        </div>
      ) : null}

      {query.isPending ? <StudioLoading label="正在加载连接…" /> : null}
      {query.isError ? (
        <StudioError
          error={query.error}
          onRetry={() => {
            void query.refetch()
          }}
        />
      ) : null}
      {query.isSuccess && query.data.length === 0 ? (
        <div data-testid="providers-empty">
          <EmptyState
            icon="◇"
            title="还没有模型连接"
            description="先添加一个 Mock 连接可以离线跑通链路；接入真实模型时再填写 API Key。"
            action={<Button onClick={startCreate}>添加第一个连接</Button>}
          />
        </div>
      ) : null}
      {query.isSuccess && query.data.length > 0 ? (
        <div className="provider-list">
          {query.data.map((connection) => (
            <SurfaceCard key={connection.id} asChild>
              <article
                className="provider-card"
                data-testid="provider-card"
                data-provider-id={connection.id}
                data-adapter={connection.adapter}
              >
                <SectionHeader
                  title={connection.label}
                  description={`${ADAPTER_LABELS[connection.adapter]} · ${connection.kind === 'chat' ? '对话' : '生图'}`}
                  actions={
                    <StatusPill
                      label={connection.enabled ? '已启用' : '已停用'}
                      tone={connection.enabled ? 'success' : 'neutral'}
                    />
                  }
                />
                <dl className="provider-meta">
                  {connection.baseUrl ? (
                    <>
                      <dt>Base URL</dt>
                      <dd>
                        <code>{connection.baseUrl}</code>
                      </dd>
                    </>
                  ) : null}
                  {connection.model ? (
                    <>
                      <dt>模型</dt>
                      <dd>
                        <code>{connection.model}</code>
                      </dd>
                    </>
                  ) : null}
                  <dt>密钥</dt>
                  <dd
                    className="provider-secret-state"
                    data-testid="provider-secret-state"
                    data-has-secret={connection.hasSecret ? 'true' : 'false'}
                  >
                    {connection.adapter === 'mock'
                      ? '无需密钥'
                      : connection.hasSecret
                        ? '密钥已保存在系统钥匙串'
                        : '尚未配置密钥'}
                  </dd>
                  <dt>更新</dt>
                  <dd>{formatDateTime(connection.updatedAt)}</dd>
                </dl>
                <div className="provider-actions">
                  <Button variant="quiet" onClick={() => startEdit(connection)}>
                    编辑
                  </Button>
                  <AsyncButton
                    variant="secondary"
                    busy={togglingId === connection.id}
                    busyLabel="正在更新…"
                    onClick={() => {
                      void toggleEnabled(connection)
                    }}
                  >
                    {connection.enabled ? '停用' : canToggle(connection) ? '启用' : '配置密钥'}
                  </AsyncButton>
                </div>
              </article>
            </SurfaceCard>
          ))}
        </div>
      ) : null}

      {editor ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) closeEditor()
          }}
          title={editor.mode === 'create' ? '添加模型连接' : '编辑模型连接'}
          description="连接类型创建后不可变；密钥只保存在本机系统钥匙串，不会写入项目数据、日志或页面存储。"
          busy={saving}
          footer={
            <>
              <Button variant="quiet" disabled={saving} onClick={closeEditor}>
                取消
              </Button>
              <AsyncButton
                type="submit"
                form={PROVIDER_FORM_ID}
                data-testid="provider-submit"
                busy={saving}
                busyLabel="保存中…"
              >
                保存连接
              </AsyncButton>
            </>
          }
        >
          <form
            id={PROVIDER_FORM_ID}
            className="provider-form"
            noValidate
            onSubmit={(event) => {
              void onSubmit(event)
            }}
          >
            <Field label="连接类型" description={preset?.description ?? ''}>
              <Select
                data-testid="provider-preset"
                value={editor.values.presetId}
                disabled={editor.mode === 'edit'}
                onValueChange={onPresetChange}
              >
                {PROVIDER_PRESETS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="连接名称" {...(failure?.fields.label ? { error: failure.fields.label } : {})}>
              <TextField
                data-testid="provider-label"
                value={editor.values.label}
                maxLength={80}
                onValueChange={(value) => updateField('label', value)}
              />
            </Field>

            {preset?.requiresSecret ? (
              <>
                <Field
                  label="API Base URL"
                  {...(failure?.fields.baseUrl ? { error: failure.fields.baseUrl } : {})}
                >
                  <TextField
                    data-testid="provider-base-url"
                    value={editor.values.baseUrl}
                    onValueChange={(value) => updateField('baseUrl', value)}
                    spellCheck={false}
                  />
                </Field>
                <Field label="模型名" {...(failure?.fields.model ? { error: failure.fields.model } : {})}>
                  <TextField
                    data-testid="provider-model"
                    value={editor.values.model}
                    onValueChange={(value) => updateField('model', value)}
                    spellCheck={false}
                  />
                </Field>
                <Field
                  label="API Key"
                  description={
                    editor.mode === 'edit'
                      ? '留空则保留现有密钥；只在轮换密钥时填写。'
                      : '仅通过本机 preload 密钥桥保存；不会进入请求体、查询缓存或日志。'
                  }
                  {...(failure?.fields.apiKey ? { error: failure.fields.apiKey } : {})}
                >
                  <TextField
                    data-testid="provider-api-key"
                    type="password"
                    autoComplete="new-password"
                    value={editor.values.apiKey}
                    onValueChange={(value) => updateField('apiKey', value)}
                    placeholder={editor.mode === 'edit' ? '仅在轮换密钥时填写' : 'sk-…'}
                  />
                </Field>
              </>
            ) : (
              <InlineNotice tone="info">Mock 连接不访问网络，不需要 API Key。</InlineNotice>
            )}

            {editor.mode === 'edit' ? (
              <div className="provider-toggle-row">
                <div>
                  <span className="provider-toggle-label">保存后启用</span>
                  <p className="provider-toggle-hint">真实连接只有在密钥保存成功并通过校验后才会启用。</p>
                </div>
                <Switch
                  aria-label="保存后启用"
                  data-testid="provider-enabled"
                  checked={editor.values.enabled}
                  disabled={saving}
                  onCheckedChange={(checked) => updateField('enabled', checked)}
                />
              </div>
            ) : null}

            {failure ? (
              <div role="alert" data-testid="provider-form-error">
                <InlineNotice tone="danger">{failure.message}</InlineNotice>
              </div>
            ) : null}
          </form>
        </Dialog>
      ) : null}
    </div>
  )
}
