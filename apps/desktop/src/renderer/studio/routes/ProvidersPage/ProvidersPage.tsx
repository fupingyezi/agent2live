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
  editCatalogPatch,
  initialProviderValues,
  modelsForConnectionKind,
  presetIdForConnection,
  presetModelsFor,
  providerDisplayName,
  providerModels,
  updateProviderFlow,
  type ProviderFlowPort,
  type ProviderFormValues,
  type ProviderModelProfile,
  type ProviderPresetId
} from '@studio/providers'
import { ProviderCard, type ProviderProbeState } from './ProviderCard'
import { PROVIDER_FORM_ID, ProviderEditor, type ProviderFormFailure } from './ProviderEditor'
import styles from './ProvidersPage.module.scss'

interface EditorState {
  mode: 'create' | 'edit'
  connection: ProviderConnectionDto | null
  values: ProviderFormValues
  models: ProviderModelProfile[] | null
}

const port: ProviderFlowPort = {
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
  }
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
  const [probingId, setProbingId] = useState<string | null>(null)
  const [pendingImageProbe, setPendingImageProbe] = useState<ProviderConnectionDto | null>(null)
  const [probeResults, setProbeResults] = useState<Record<string, ProviderProbeState>>({})
  const [pageError, setPageError] = useState<string | null>(null)

  const query = useQuery({
    queryKey: queryKeys.providers,
    queryFn: ({ signal }) => listProviders(signal)
  })

  const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: queryKeys.providers })

  const startCreate = (): void => {
    const values = initialProviderValues('deepseek-chat')
    setEditor({
      mode: 'create',
      connection: null,
      values,
      models: presetModelsFor(values.presetId)
    })
    setFailure(null)
    setPageError(null)
  }

  const startEdit = (connection: ProviderConnectionDto): void => {
    const presetId = presetIdForConnection(connection)
    const fallbackModels = presetId && presetId !== 'custom' ? presetModelsFor(presetId) : []
    const models = modelsForConnectionKind(
      connection.models.length > 0 ? connection.models : fallbackModels,
      connection.kind
    )
    const selected = models.find((model) => model.id === connection.model) ?? models[0]
    setEditor({
      mode: 'edit',
      connection,
      values: {
        presetId: presetId ?? 'custom',
        label: connection.label,
        baseUrl: connection.baseUrl ?? '',
        kind: connection.kind,
        adapter: connection.adapter === 'seedream' ? 'seedream' : 'openai-compatible',
        manualModel: selected?.id ?? connection.model ?? '',
        apiKey: '',
        enabled: connection.enabled
      },
      models
    })
    setFailure(null)
    setPageError(null)
  }

  const closeEditor = (): void => {
    if (saving) return
    setEditor(null)
    setFailure(null)
  }

  const updateValues = (patch: Partial<ProviderFormValues>): void => {
    if (!editor) return
    const custom = editor.values.presetId === 'custom'
    const endpointChanged =
      custom && (patch.baseUrl !== undefined || patch.kind !== undefined || patch.adapter !== undefined)
    setEditor({
      ...editor,
      values: {
        ...editor.values,
        ...patch,
        ...(endpointChanged ? { manualModel: '' } : {})
      },
      ...(endpointChanged ? { models: null } : {})
    })
    setFailure(null)
  }

  const onPresetChange = (presetId: ProviderPresetId): void => {
    if (!editor || editor.mode === 'edit') return
    const values = initialProviderValues(presetId)
    setEditor({
      ...editor,
      values,
      models: presetId === 'custom' ? null : presetModelsFor(presetId)
    })
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
        await createProviderFlow(port, editor.values, editor.models ?? [], null)
        setNotice('模型供应商已保存。')
      } else if (editor.connection) {
        if (editor.connection.adapter === 'mock') {
          await updateProvider(
            editor.connection.id,
            { enabled: editor.values.enabled },
            editor.connection.rowVersion
          )
          setNotice('模型供应商已更新。')
          setEditor(null)
          await invalidate()
          return
        }
        const models = editCatalogPatch(editor.values, editor.connection, editor.models)
        await updateProviderFlow(port, editor.connection, editor.values, {
          ...(models ? { models } : {})
        })
        setNotice('模型供应商已更新。')
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
      setNotice(connection.enabled ? '模型供应商已停用。' : '模型供应商已启用。')
    } catch (error) {
      setPageError(error instanceof ApiError ? error.message : '更新连接状态失败。')
    } finally {
      setTogglingId(null)
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
  const imageProvider = providers.find(
    (connection) => connection.enabled && providerModels(connection, 'image').length > 0
  )
  const chatProvider = providers.find(
    (connection) => connection.enabled && providerModels(connection, 'chat').length > 0
  )

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
          description="固定供应商使用内置的新版模型，填写 API Key 后选择默认模型；自定义可配置地址与模型。密钥只保存在本机系统钥匙串。"
          actions={
            <Button data-testid="add-provider" onClick={startCreate}>
              添加模型供应商
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
              title="还没有模型供应商"
              description="添加固定供应商，或配置自定义供应商；填写 API Key 并选择模型。"
              action={<Button onClick={startCreate}>添加第一个模型供应商</Button>}
            />
          </div>
        ) : null}
        {query.isSuccess && providers.length > 0 ? (
          <div className={styles['provider-list']!}>
            {providers.map((connection) => (
              <ProviderCard
                key={connection.id}
                connection={connection}
                toggling={togglingId === connection.id}
                probing={probingId === connection.id}
                probeResult={probeResults[connection.id]}
                onEdit={startEdit}
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
            <SectionHeader title="默认分配" description="当前能力使用的首个已启用的模型供应商" />
            <div className={styles['provider-assignment-row']!}>
              <span>生成立绘候选</span>
              <strong>{imageProvider ? providerDisplayName(imageProvider) : '尚未分配'}</strong>
            </div>
            <div className={styles['provider-assignment-row']!}>
              <span>提示词与人格</span>
              <strong>{chatProvider ? providerDisplayName(chatProvider) : '尚未分配'}</strong>
            </div>
          </section>
        ) : null}

        <section className={styles['provider-service-state']!} data-testid="provider-service-state">
          <StatusPill label="本地服务运行中" tone="success" />
          <div>
            <strong>模型管理可用</strong>
            <p>供应商与密钥保存在本机；测试失败不会停用现有供应商。</p>
          </div>
        </section>

        {editor ? (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) closeEditor()
            }}
            title={editor.mode === 'create' ? '添加模型供应商' : '编辑模型供应商'}
            description="供应商类型创建后不可变"
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
              key={`${editor.mode}:${editor.connection?.id ?? 'new'}`}
              mode={editor.mode}
              values={editor.values}
              failure={failure}
              saving={saving}
              models={editor.models}
              legacyMock={editor.connection?.adapter === 'mock'}
              hasSecret={editor.connection?.hasSecret ?? false}
              onChange={updateValues}
              onPresetChange={onPresetChange}
              onSubmit={(event) => {
                void onSubmit(event)
              }}
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
