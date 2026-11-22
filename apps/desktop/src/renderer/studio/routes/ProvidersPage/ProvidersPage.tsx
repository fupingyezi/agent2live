import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AsyncButton,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  InlineNotice,
  PageHeader,
  SectionHeader,
  StatusPill,
  type EmptyProps
} from '@agent2live/design-system'
import { ApiError, queryKeys } from '@studio/api'
import {
  createProvider,
  getProvider,
  listProviders,
  previewProviderModels,
  refreshProviderModels,
  testProviderConnection,
  updateProvider
} from '@studio/api'
import type { ProviderConnectionDto } from '@studio/api'
import { StudioError } from '@studio/components'
import { StudioLoading } from '@studio/components'
import {
  ProviderActivationError,
  ProviderFormError,
  createProviderFlow,
  initialProviderValues,
  manualModelProfile,
  presetIdForConnection,
  previewModelsForForm,
  providerModels,
  updateProviderFlow,
  type ProviderFlowPort,
  type ProviderFormValues,
  type ProviderModelProfile,
  type ProviderModelsPort,
  type ProviderPresetId
} from '@studio/providers'
import { ProviderCard, type ProviderProbeState } from './ProviderCard'
import { PROVIDER_FORM_ID, ProviderEditor, type ProviderFormFailure } from './ProviderEditor'
import styles from './ProvidersPage.module.scss'

const CUSTOM_URL_KEY_MESSAGE = '修改 Base URL 后请重新填写 API Key 再获取模型。'

interface EditorState {
  mode: 'create' | 'edit'
  connection: ProviderConnectionDto | null
  values: ProviderFormValues
  models: ProviderModelProfile[] | null
  modelsError: string | null
  fetchingModels: boolean
  draftSecretRef: string | null
  draftLabel: string
}

const port: ProviderFlowPort & ProviderModelsPort = {
  create: createProvider,
  update: updateProvider,
  get: getProvider,
  storeSecret: (input) => {
    const bridge = window.agent2live
    if (!bridge) return Promise.reject(new Error('agent2live preload bridge is unavailable'))
    return bridge.secrets.store(input)
  },
  deleteSecret: (secretRef) => {
    const bridge = window.agent2live
    if (!bridge) return Promise.resolve()
    return bridge.secrets.delete(secretRef).then(() => undefined)
  },
  previewModels: previewProviderModels,
  refreshModels: refreshProviderModels
}

function failureFrom(error: unknown): ProviderFormFailure {
  if (error instanceof ProviderFormError) {
    return { message: '请修正表单中的问题。', fields: error.fields }
  }
  if (error instanceof ProviderActivationError) {
    return {
      message: error.message,
      fields: {}
    }
  }
  if (error instanceof ApiError) {
    return { message: error.message, fields: {} }
  }
  return { message: error instanceof Error ? error.message : '保存失败，请重试。', fields: {} }
}

export const ProvidersPage: React.FC<EmptyProps> = () => {
  const queryClient = useQueryClient()
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [failure, setFailure] = useState<ProviderFormFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [probingId, setProbingId] = useState<string | null>(null)
  const [pendingImageProbe, setPendingImageProbe] = useState<ProviderConnectionDto | null>(null)
  const [probeResults, setProbeResults] = useState<Record<string, ProviderProbeState>>({})
  const [pageError, setPageError] = useState<string | null>(null)

  const query = useQuery({
    queryKey: queryKeys.providers,
    queryFn: ({ signal }) => listProviders(signal)
  })

  const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: queryKeys.providers })

  const discardDraft = (secretRef: string | null): void => {
    if (secretRef) void port.deleteSecret(secretRef).catch(() => undefined)
  }

  const startCreate = (): void => {
    setEditor({
      mode: 'create',
      connection: null,
      values: initialProviderValues('deepseek-chat'),
      models: null,
      modelsError: null,
      fetchingModels: false,
      draftSecretRef: null,
      draftLabel: `provider-draft:${crypto.randomUUID()}`
    })
    setFailure(null)
    setPageError(null)
  }

  const startEdit = (connection: ProviderConnectionDto): void => {
    const presetId = presetIdForConnection(connection)
    setEditor({
      mode: 'edit',
      connection,
      values: {
        presetId: presetId ?? 'custom',
        label: connection.label,
        baseUrl: connection.baseUrl ?? '',
        kind: connection.kind,
        adapter: connection.adapter === 'seedream' ? 'seedream' : 'openai-compatible',
        manualModel: connection.model ?? '',
        apiKey: '',
        enabled: connection.enabled
      },
      models: connection.models,
      modelsError: null,
      fetchingModels: false,
      draftSecretRef: null,
      draftLabel: `provider-draft:${crypto.randomUUID()}`
    })
    setFailure(null)
    setPageError(null)
  }

  const closeEditor = (): void => {
    if (saving) return
    const draft = editor?.draftSecretRef
    setEditor(null)
    setFailure(null)
    discardDraft(draft ?? null)
  }

  const updateValues = (patch: Partial<ProviderFormValues>): void => {
    if (!editor) return
    const custom = editor.values.presetId === 'custom'
    const catalogInvalidated =
      patch.apiKey !== undefined ||
      (custom && (patch.baseUrl !== undefined || patch.kind !== undefined || patch.adapter !== undefined))
    if (catalogInvalidated) discardDraft(editor.draftSecretRef)
    const values: ProviderFormValues = {
      ...editor.values,
      ...patch,
      ...(editor.mode === 'create' && patch.apiKey !== undefined ? { manualModel: '' } : {})
    }
    const customUrlChanged =
      editor.mode === 'edit' && custom && values.baseUrl.trim() !== (editor.connection?.baseUrl ?? '')
    const modelsError =
      catalogInvalidated && customUrlChanged && !values.apiKey.trim() ? CUSTOM_URL_KEY_MESSAGE : null
    setEditor({
      ...editor,
      values,
      ...(catalogInvalidated ? { models: null, draftSecretRef: null, modelsError } : {})
    })
    setFailure(null)
  }

  const onPresetChange = (presetId: ProviderPresetId): void => {
    if (!editor || editor.mode === 'edit') return
    discardDraft(editor.draftSecretRef)
    setEditor({
      ...editor,
      values: initialProviderValues(presetId),
      models: null,
      modelsError: null,
      fetchingModels: false,
      draftSecretRef: null
    })
    setFailure(null)
  }

  const fetchModels = async (): Promise<void> => {
    if (!editor || editor.fetchingModels) return
    if (editor.connection?.adapter === 'mock') return
    if (
      editor.mode === 'edit' &&
      editor.values.presetId === 'custom' &&
      editor.connection &&
      editor.values.baseUrl.trim() !== (editor.connection.baseUrl ?? '') &&
      !editor.values.apiKey.trim()
    ) {
      setEditor((current) => (current ? { ...current, modelsError: CUSTOM_URL_KEY_MESSAGE } : current))
      return
    }
    setEditor({ ...editor, fetchingModels: true, modelsError: null })
    setPageError(null)
    try {
      if (editor.mode === 'edit' && editor.connection && !editor.values.apiKey.trim()) {
        const updated = await refreshProviderModels(editor.connection.id, editor.connection.rowVersion)
        setEditor((current) =>
          current
            ? { ...current, connection: updated, models: updated.models, fetchingModels: false }
            : current
        )
        await invalidate()
        setNotice('模型目录已刷新。')
        return
      }
      const { secretRef, models } = await previewModelsForForm(port, editor.values, editor.draftLabel)
      setEditor((current) =>
        current
          ? {
              ...current,
              models,
              ...(current.values.presetId === 'custom' && models.length > 0 && !current.values.manualModel
                ? { values: { ...current.values, manualModel: models[0]!.id } }
                : {}),
              draftSecretRef: secretRef,
              fetchingModels: false,
              modelsError: models.length === 0 ? '当前 Key 下没有产品支持的模型。' : null
            }
          : current
      )
    } catch (error) {
      setEditor((current) =>
        current
          ? {
              ...current,
              fetchingModels: false,
              modelsError:
                error instanceof ProviderFormError
                  ? (Object.values(error.fields)[0] ?? error.message)
                  : error instanceof ApiError
                    ? error.message
                    : error instanceof Error
                      ? error.message
                      : '模型目录获取失败。'
            }
          : current
      )
    }
  }

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!editor || saving) return
    setSaving(true)
    setFailure(null)
    setPageError(null)
    try {
      if (editor.mode === 'create') {
        await createProviderFlow(port, editor.values, editor.models ?? [], editor.draftSecretRef)
        setNotice('连接与模型目录已保存。')
      } else if (editor.connection) {
        if (editor.connection.adapter === 'mock') {
          await updateProvider(
            editor.connection.id,
            {
              label: editor.values.label.trim(),
              enabled: editor.values.enabled
            },
            editor.connection.rowVersion
          )
          setNotice('连接已更新。')
          setEditor(null)
          await invalidate()
          return
        }
        const manual =
          editor.values.presetId === 'custom' &&
          (editor.models === null || editor.models.length === 0) &&
          editor.values.manualModel.trim()
            ? [manualModelProfile(editor.values)]
            : undefined
        const modelsChanged =
          editor.models !== null && JSON.stringify(editor.models) !== JSON.stringify(editor.connection.models)
        await updateProviderFlow(port, editor.connection, editor.values, {
          ...(modelsChanged ? { models: editor.models! } : manual ? { models: manual } : {}),
          draftSecretRef: editor.draftSecretRef
        })
        setNotice('连接已更新。')
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

  const refreshCard = async (connection: ProviderConnectionDto): Promise<void> => {
    if (refreshingId) return
    setRefreshingId(connection.id)
    setPageError(null)
    try {
      await refreshProviderModels(connection.id, connection.rowVersion)
      await invalidate()
      setNotice('模型目录已刷新。')
    } catch (error) {
      setPageError(error instanceof ApiError ? error.message : '模型目录刷新失败。')
    } finally {
      setRefreshingId(null)
    }
  }

  const probe = async (connection: ProviderConnectionDto, allowBillableRequest: boolean): Promise<void> => {
    if (probingId) return
    setProbingId(connection.id)
    setProbeResults((current) => {
      const next = { ...current }
      delete next[connection.id]
      return next
    })
    try {
      const result = await testProviderConnection(connection.id, { allowBillableRequest })
      setProbeResults((current) => ({ ...current, [connection.id]: { result } }))
    } catch (error) {
      setProbeResults((current) => ({
        ...current,
        [connection.id]: {
          error: error instanceof ApiError ? error.message : '连接测试失败，请稍后重试。'
        }
      }))
    } finally {
      setProbingId(null)
    }
  }

  const providers = query.data ?? []
  const imageLabel = providers.find(
    (connection) => connection.enabled && providerModels(connection, 'image').length > 0
  )?.label
  const chatLabel = providers.find(
    (connection) => connection.enabled && providerModels(connection, 'chat').length > 0
  )?.label

  return (
    <div className={`${styles['studio-settings-layout']!} providers-page`} data-testid="providers-page">
      <aside className={styles['studio-settings-nav']!} aria-label="设置导航">
        <strong>设置</strong>
        <button type="button" data-state="active">
          模型供应商
        </button>
        <button type="button" disabled>
          工具与授权
        </button>
        <button type="button" disabled>
          MCP 服务
        </button>
        <button type="button" disabled>
          技能
        </button>
        <button type="button" disabled>
          扩展
        </button>
      </aside>
      <main className={`studio-page ${styles['studio-settings-main']!}`}>
        <PageHeader
          eyebrow="设置"
          title="模型供应商"
          description="固定服务商只需填写 API Key，模型目录从 /models 实时读取；密钥只保存在本机系统钥匙串。"
          actions={
            <Button data-testid="add-provider" onClick={startCreate}>
              添加连接
            </Button>
          }
        />

        {notice ? (
          <div className={styles['page-notice']!}>
            <InlineNotice tone="success">{notice}</InlineNotice>
          </div>
        ) : null}
        {pageError ? (
          <div className={styles['page-notice']!} role="alert">
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
        {query.isSuccess && providers.length === 0 ? (
          <div data-testid="providers-empty">
            <EmptyState
              icon="◇"
              title="还没有模型连接"
              description="添加一个固定服务商或自定义连接，保存 API Key 后即可实时获取模型目录。"
              action={<Button onClick={startCreate}>添加第一个连接</Button>}
            />
          </div>
        ) : null}
        {query.isSuccess && providers.length > 0 ? (
          <div className={styles['provider-list']!}>
            {providers.map((connection) => (
              <ProviderCard
                key={connection.id}
                connection={connection}
                refreshing={refreshingId === connection.id}
                toggling={togglingId === connection.id}
                probing={probingId === connection.id}
                probeResult={probeResults[connection.id]}
                onEdit={startEdit}
                onRefresh={(item) => {
                  void refreshCard(item)
                }}
                onToggle={(item) => {
                  void toggleEnabled(item)
                }}
                onProbe={(item) => {
                  if (item.kind === 'image') setPendingImageProbe(item)
                  else void probe(item, false)
                }}
              />
            ))}
          </div>
        ) : null}

        {query.isSuccess && providers.length > 0 ? (
          <section className={styles['provider-assignment']!} aria-label="默认模型分配">
            <SectionHeader title="默认分配" description="当前能力使用的首个已启用连接" />
            <div className={styles['provider-assignment-row']!}>
              <span>生成立绘候选</span>
              <strong>{imageLabel ?? '尚未分配'}</strong>
            </div>
            <div className={styles['provider-assignment-row']!}>
              <span>提示词与人格</span>
              <strong>{chatLabel ?? '尚未分配'}</strong>
            </div>
          </section>
        ) : null}

        <section className={styles['provider-service-state']!} data-testid="provider-service-state">
          <StatusPill label="本地服务运行中" tone="success" />
          <div>
            <strong>模型管理可用</strong>
            <p>连接与密钥保存在本机；测试失败不会停用现有连接。</p>
          </div>
        </section>

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
            <ProviderEditor
              mode={editor.mode}
              values={editor.values}
              failure={failure}
              saving={saving}
              fetchingModels={editor.fetchingModels}
              models={editor.models}
              modelsError={editor.modelsError}
              legacyMock={editor.connection?.adapter === 'mock'}
              onChange={updateValues}
              onPresetChange={onPresetChange}
              onFetchModels={() => {
                void fetchModels()
              }}
              onSubmit={(event) => {
                void onSubmit(event)
              }}
              onClose={closeEditor}
            />
          </Dialog>
        ) : null}

        <ConfirmDialog
          open={pendingImageProbe !== null}
          title="测试生图连接？"
          confirmLabel="开始测试"
          busy={probingId !== null}
          onCancel={() => setPendingImageProbe(null)}
          onConfirm={() => {
            if (!pendingImageProbe) return
            const connection = pendingImageProbe
            setPendingImageProbe(null)
            void probe(connection, true)
          }}
        >
          <p>该测试会请求一张最小生图结果，真实模型可能产生费用。Mock 连接不会访问网络。</p>
        </ConfirmDialog>
      </main>
    </div>
  )
}
