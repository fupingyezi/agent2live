import React, { useState } from 'react'
import { Field, InlineNotice, Select, Switch, TextField } from '@agent2live/design-system'
import {
  FIXED_PROVIDER_PRESETS,
  getFixedProviderPreset,
  modelOptionLabel,
  modelsForConnectionKind,
  type ProviderConnectionFormValues,
  type ProviderModelProfile,
  type ProviderPresetId
} from '@studio/providers'
import styles from './ProvidersPage.module.scss'

export const PROVIDER_CONNECTION_FORM_ID = 'provider-editor-form'

const SECRET_MASK = '••••••••'

export interface ProviderConnectionFormFailure {
  message: string
  fields: Partial<Record<'label' | 'baseUrl' | 'model' | 'apiKey', string>>
}

export interface ProviderConnectionEditorProps {
  mode: 'create' | 'edit'
  values: ProviderConnectionFormValues
  failure: ProviderConnectionFormFailure | null
  saving: boolean
  models: ProviderModelProfile[] | null
  legacyMock: boolean
  hasSecret: boolean
  onChange(patch: Partial<ProviderConnectionFormValues>): void
  onPresetChange(presetId: ProviderPresetId): void
  onSubmit(event: React.FormEvent<HTMLFormElement>): void
}

export const ProviderConnectionEditor: React.FC<ProviderConnectionEditorProps> = ({
  mode,
  values,
  failure,
  saving,
  models,
  legacyMock,
  hasSecret,
  onChange,
  onPresetChange,
  onSubmit
}) => {
  const [keyDirty, setKeyDirty] = useState(false)
  const presetDescription =
    values.presetId === 'custom'
      ? '自定义 Base URL、协议和模型名。'
      : (getFixedProviderPreset(values.presetId)?.description ?? '')

  const custom = values.presetId === 'custom'
  const customModelVisible = custom && (!models || models.length === 0)
  const selectableModels =
    mode === 'edit' && models ? modelsForConnectionKind(models, values.kind) : (models ?? [])
  const modelSelectVisible = !legacyMock && selectableModels.length > 0
  const modelError = failure?.fields.model
  const showSecretMask = mode === 'edit' && hasSecret && !keyDirty

  return (
    <form
      id={PROVIDER_CONNECTION_FORM_ID}
      className={styles['provider-form']!}
      noValidate
      onSubmit={onSubmit}
    >
      {legacyMock ? null : mode === 'create' ? (
        <Field label="供应商类型" description={presetDescription}>
          <Select
            data-testid="provider-preset"
            value={values.presetId}
            disabled={saving}
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
      ) : (
        <Field label="供应商类型" description={presetDescription}>
          <span data-testid="provider-preset-readonly">
            {custom ? '自定义' : (getFixedProviderPreset(values.presetId)?.name ?? values.presetId)}
          </span>
        </Field>
      )}

      {legacyMock || !custom ? null : (
        <Field label="API Base URL" {...(failure?.fields.baseUrl ? { error: failure.fields.baseUrl } : {})}>
          <TextField
            data-testid="provider-base-url"
            value={values.baseUrl}
            onValueChange={(value) => onChange({ baseUrl: value })}
            spellCheck={false}
          />
        </Field>
      )}

      {legacyMock || !custom ? null : mode === 'create' ? (
        <>
          <Field label="类型">
            <Select
              data-testid="provider-kind"
              value={values.kind}
              disabled={saving}
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
              disabled={values.kind === 'chat' || saving}
              onValueChange={(value) => onChange({ adapter: value as 'openai-compatible' | 'seedream' })}
            >
              <option value="openai-compatible">OpenAI 兼容对话</option>
              <option value="seedream">Seedream 兼容生图</option>
            </Select>
          </Field>
        </>
      ) : (
        <>
          <Field label="类型">
            <span data-testid="provider-kind-readonly">{values.kind === 'chat' ? '对话' : '生图'}</span>
          </Field>
          <Field label="协议">
            <span data-testid="provider-protocol-readonly">
              {values.adapter === 'seedream' ? 'Seedream 兼容生图' : 'OpenAI 兼容对话'}
            </span>
          </Field>
        </>
      )}

      {legacyMock ? null : (
        <Field label="API Key">
          <TextField
            data-testid="provider-api-key"
            type="password"
            autoComplete="new-password"
            value={showSecretMask ? SECRET_MASK : values.apiKey}
            onFocus={(event) => {
              if (showSecretMask) event.currentTarget.select()
            }}
            onClick={(event) => {
              if (showSecretMask) event.currentTarget.select()
            }}
            onValueChange={(value) => {
              if (showSecretMask) {
                setKeyDirty(true)
                // 掩码只是展示值，任何输入都先剥离掩码字符，绝不写入表单状态。
                onChange({ apiKey: value.replaceAll('•', '') })
                return
              }
              onChange({ apiKey: value })
            }}
            placeholder={showSecretMask ? undefined : 'sk-…'}
          />
        </Field>
      )}

      {modelSelectVisible ? (
        <Field label="默认模型" {...(modelError ? { error: modelError } : {})}>
          <Select
            data-testid="provider-model-select"
            value={values.defaultModelId}
            disabled={saving}
            onValueChange={(value) => onChange({ defaultModelId: value })}
          >
            {selectableModels.map((model) => (
              <option key={model.id} value={model.id}>
                {modelOptionLabel(model)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {customModelVisible ? (
        <Field
          label="模型名"
          description="自定义供应商手工填写模型名。"
          {...(modelError ? { error: modelError } : {})}
        >
          <TextField
            data-testid="provider-model-manual"
            value={values.customModelId}
            onValueChange={(value) => onChange({ customModelId: value })}
            spellCheck={false}
          />
        </Field>
      ) : null}

      {mode === 'edit' ? (
        <div className={styles['provider-toggle-row']!}>
          <div>
            <span className={styles['provider-toggle-label']!}>保存后启用</span>
            <p className={styles['provider-toggle-hint']!}>
              {legacyMock
                ? 'Mock 旧连接只保留启用状态，不访问网络。'
                : '真实供应商只有在密钥保存成功并通过校验后才会启用。'}
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
        <InlineNotice tone="info">Mock 旧连接只支持启用/停用；它不访问网络，也没有模型目录。</InlineNotice>
      ) : null}

      {failure ? (
        <div role="alert" data-testid="provider-form-error">
          <InlineNotice tone="danger">{failure.message}</InlineNotice>
        </div>
      ) : null}
    </form>
  )
}
