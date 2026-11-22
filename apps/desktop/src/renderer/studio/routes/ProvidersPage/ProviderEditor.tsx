import React from 'react'
import { AsyncButton, Field, InlineNotice, Select, Switch, TextField } from '@agent2live/design-system'
import {
  FIXED_PROVIDER_PRESETS,
  getFixedProviderPreset,
  type ProviderFormValues,
  type ProviderModelProfile,
  type ProviderPresetId
} from '@studio/providers'
import styles from './ProvidersPage.module.scss'

export const PROVIDER_FORM_ID = 'provider-editor-form'

export interface ProviderFormFailure {
  message: string
  fields: Partial<Record<'label' | 'baseUrl' | 'model' | 'apiKey', string>>
}

export interface ProviderEditorProps {
  mode: 'create' | 'edit'
  values: ProviderFormValues
  failure: ProviderFormFailure | null
  saving: boolean
  fetchingModels: boolean
  models: ProviderModelProfile[] | null
  modelsError: string | null
  legacyMock: boolean
  onChange(patch: Partial<ProviderFormValues>): void
  onPresetChange(presetId: ProviderPresetId): void
  onFetchModels(): void
  onSubmit(event: React.FormEvent<HTMLFormElement>): void
  onClose(): void
}

export const ProviderEditor: React.FC<ProviderEditorProps> = ({
  mode,
  values,
  failure,
  saving,
  fetchingModels,
  models,
  modelsError,
  legacyMock,
  onChange,
  onPresetChange,
  onFetchModels,
  onSubmit
}) => {
  const presetDescription =
    values.presetId === 'custom'
      ? '自定义 Base URL、协议与手工模型；模型目录可选。'
      : (getFixedProviderPreset(values.presetId)?.description ?? '')

  const counts = (models ?? []).reduce(
    (acc, model) => {
      if (model.kind === 'image') acc.image += 1
      else if (model.capabilities.chat?.supportsVision === true) acc.vision += 1
      else acc.chat += 1
      return acc
    },
    { chat: 0, vision: 0, image: 0 }
  )

  const manualModelVisible = !legacyMock && values.presetId === 'custom' && (!models || models.length === 0)
  const modelSelectVisible =
    !legacyMock && values.presetId === 'custom' && models !== null && models.length > 0

  return (
    <form id={PROVIDER_FORM_ID} className={styles['provider-form']!} noValidate onSubmit={onSubmit}>
      {legacyMock ? null : (
        <Field label="连接类型" description={presetDescription}>
          <Select
            data-testid="provider-preset"
            value={values.presetId}
            disabled={mode === 'edit' || saving}
            onValueChange={(value) => onPresetChange(value as ProviderPresetId)}
          >
            {FIXED_PROVIDER_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
            <option value="custom">自定义</option>
          </Select>
        </Field>
      )}

      <Field label="连接名称" {...(failure?.fields.label ? { error: failure.fields.label } : {})}>
        <TextField
          data-testid="provider-label"
          value={values.label}
          maxLength={80}
          onValueChange={(value) => onChange({ label: value })}
        />
      </Field>

      {legacyMock ? null : values.presetId === 'custom' ? (
        <Field label="API Base URL" {...(failure?.fields.baseUrl ? { error: failure.fields.baseUrl } : {})}>
          <TextField
            data-testid="provider-base-url"
            value={values.baseUrl}
            onValueChange={(value) => onChange({ baseUrl: value })}
            spellCheck={false}
          />
        </Field>
      ) : (
        <Field label="API Base URL">
          <code data-testid="provider-fixed-base-url">{values.baseUrl}</code>
        </Field>
      )}

      {legacyMock || values.presetId !== 'custom' ? null : (
        <>
          <Field
            label="类型"
            {...(values.kind === 'image'
              ? {
                  description: '自动发现只列出 Seedream/SeedEdit 兼容模型；其他生图模型请手工填写模型名。'
                }
              : {})}
          >
            <Select
              data-testid="provider-kind"
              value={values.kind}
              disabled={mode === 'edit' || saving}
              onValueChange={(value) =>
                onChange({
                  kind: value as 'chat' | 'image',
                  adapter: value === 'chat' ? 'openai-compatible' : 'seedream'
                })
              }
            >
              <option value="chat">对话</option>
              <option value="image">生图</option>
            </Select>
          </Field>
          <Field label="协议">
            <Select
              data-testid="provider-protocol"
              value={values.adapter}
              disabled={values.kind === 'chat' || mode === 'edit' || saving}
              onValueChange={(value) => onChange({ adapter: value as 'openai-compatible' | 'seedream' })}
            >
              <option value="openai-compatible">OpenAI 兼容对话</option>
              <option value="seedream">Seedream 兼容生图</option>
            </Select>
          </Field>
        </>
      )}

      {legacyMock ? null : (
        <Field
          label="API Key"
          description={
            mode === 'edit'
              ? '留空则保留现有密钥；刷新模型目录会直接使用钥匙串里的 Key。'
              : '仅通过本机 preload 密钥桥保存；不会进入模型目录请求或日志。'
          }
          {...(failure?.fields.apiKey ? { error: failure.fields.apiKey } : {})}
        >
          <TextField
            data-testid="provider-api-key"
            type="password"
            autoComplete="new-password"
            value={values.apiKey}
            onValueChange={(value) => onChange({ apiKey: value })}
            placeholder={mode === 'edit' ? '仅在轮换密钥时填写' : 'sk-…'}
          />
        </Field>
      )}

      {legacyMock ? null : (
        <div className={styles['provider-fetch-row']!}>
          <AsyncButton
            variant="secondary"
            data-testid="provider-fetch-models"
            busy={fetchingModels}
            busyLabel="正在获取…"
            disabled={
              fetchingModels ||
              (mode === 'create' && !values.apiKey.trim()) ||
              (values.presetId === 'custom' && !values.baseUrl.trim())
            }
            onClick={onFetchModels}
          >
            获取可用模型
          </AsyncButton>
          {models ? (
            <span data-testid="provider-model-counts">
              对话 {counts.chat} · 视觉 {counts.vision} · 生图 {counts.image}
            </span>
          ) : null}
        </div>
      )}

      {modelSelectVisible ? (
        <Field label="默认模型" description="从 /models 实时列表选择；任务中仍可改选其他模型。">
          <Select
            data-testid="provider-model-select"
            value={values.manualModel}
            onValueChange={(value) => onChange({ manualModel: value })}
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name ?? model.id}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {manualModelVisible ? (
        <Field
          label="模型名"
          description="拉取失败时可手工填写；自定义连接不会伪造模型列表。"
          {...(failure?.fields.model ? { error: failure.fields.model } : {})}
        >
          <TextField
            data-testid="provider-model-manual"
            value={values.manualModel}
            onValueChange={(value) => onChange({ manualModel: value })}
            spellCheck={false}
          />
        </Field>
      ) : null}

      {!legacyMock && models && models.length > 0 ? (
        <div data-testid="provider-models">
          <Field label="可访问模型">
            <ul className={styles['provider-model-list']!}>
              {models.map((model) => (
                <li key={model.id}>
                  <code>{model.id}</code>
                  <span>
                    {model.kind === 'image'
                      ? '生图'
                      : model.capabilities.chat?.supportsVision
                        ? '视觉'
                        : '对话'}
                  </span>
                </li>
              ))}
            </ul>
          </Field>
        </div>
      ) : null}

      {!legacyMock && (modelsError || (!manualModelVisible && failure?.fields.model)) ? (
        <div role="alert" data-testid="provider-models-error">
          <InlineNotice tone="danger">{modelsError || failure?.fields.model}</InlineNotice>
        </div>
      ) : null}

      {mode === 'edit' ? (
        <div className={styles['provider-toggle-row']!}>
          <div>
            <span className={styles['provider-toggle-label']!}>保存后启用</span>
            <p className={styles['provider-toggle-hint']!}>
              {legacyMock
                ? 'Mock 旧连接只保留连接名称与启用状态，不访问网络。'
                : '真实连接只有在密钥保存成功并通过校验后才会启用。'}
            </p>
          </div>
          <Switch
            aria-label="保存后启用"
            data-testid="provider-enabled"
            checked={values.enabled}
            disabled={saving}
            onCheckedChange={(checked) => onChange({ enabled: checked })}
          />
        </div>
      ) : null}

      {legacyMock ? (
        <InlineNotice tone="info">
          Mock 旧连接只支持修改连接名称与启用状态；它不访问网络，也没有模型目录。
        </InlineNotice>
      ) : null}

      {failure ? (
        <div role="alert" data-testid="provider-form-error">
          <InlineNotice tone="danger">{failure.message}</InlineNotice>
        </div>
      ) : null}
    </form>
  )
}
