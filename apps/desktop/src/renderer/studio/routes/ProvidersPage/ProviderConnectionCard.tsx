import React from 'react'
import { AsyncButton, Button, SectionHeader, StatusPill, SurfaceCard } from '@agent2live/design-system'
import type { ProviderConnectionDto, ProviderProbeDto } from '@studio/api'
import {
  modelOptionLabel,
  presetIdForConnection,
  connectionModelCounts,
  connectionDisplayName
} from '@studio/providers'
import styles from './ProvidersPage.module.scss'

export interface ProviderProbeState {
  result?: ProviderProbeDto
  error?: string
}

export interface ProviderConnectionCardProps {
  connection: ProviderConnectionDto
  toggling: boolean
  probing: boolean
  probeResult: ProviderProbeState | undefined
  onEdit(connection: ProviderConnectionDto): void
  onToggle(connection: ProviderConnectionDto): void
  onProbe(connection: ProviderConnectionDto): void
}

export const ProviderConnectionCard: React.FC<ProviderConnectionCardProps> = ({
  connection,
  toggling,
  probing,
  probeResult,
  onEdit,
  onToggle,
  onProbe
}) => {
  const modelCounts = connectionModelCounts(connection)
  const canToggle = connection.adapter === 'mock' || connection.hasSecret
  const displayName = connectionDisplayName(connection)
  const selectedModel = connection.models.find((model) => model.id === connection.model)
  const selectedLabel = selectedModel ? modelOptionLabel(selectedModel) : (connection.model ?? '未选择')
  const isFixedPreset = connection.adapter !== 'mock' && presetIdForConnection(connection) !== 'custom'

  return (
    <SurfaceCard asChild>
      <article
        className={styles['provider-card']!}
        data-testid="provider-card"
        data-provider-id={connection.id}
        data-adapter={connection.adapter}
      >
        <div className={styles['provider-row-main']!}>
          <span className={styles['provider-icon']!} aria-hidden="true">
            {displayName.slice(0, 1)}
          </span>
          <SectionHeader
            title={displayName}
            description={`默认 ${selectedLabel} · 对话 ${modelCounts.chat} · 视觉 ${modelCounts.vision} · 生图 ${modelCounts.image}`}
            actions={
              <StatusPill
                label={connection.enabled ? '已启用' : '已停用'}
                tone={connection.enabled ? 'success' : 'neutral'}
              />
            }
          />
        </div>
        <dl className={styles['provider-meta']!}>
          {connection.baseUrl && !isFixedPreset ? (
            <>
              <dt>Base URL</dt>
              <dd>
                <code>{connection.baseUrl}</code>
              </dd>
            </>
          ) : null}
          <dt>默认模型</dt>
          <dd data-testid="provider-selected-model">{selectedLabel}</dd>
          <dt>密钥</dt>
          <dd
            className={styles['provider-secret-state']!}
            data-testid="provider-secret-state"
            data-has-secret={connection.hasSecret ? 'true' : 'false'}
          >
            {connection.adapter === 'mock' ? '无需密钥' : connection.hasSecret ? '已保存' : '未配置'}
          </dd>
          <dt>可选模型</dt>
          <dd data-testid="provider-model-catalog">{connection.models.length} 个</dd>
        </dl>
        <div className={styles['provider-actions']!}>
          <Button variant="quiet" onClick={() => onEdit(connection)}>
            编辑
          </Button>
          <AsyncButton
            variant="secondary"
            busy={toggling}
            busyLabel="正在更新…"
            onClick={() => onToggle(connection)}
          >
            {connection.enabled ? '停用' : canToggle ? '启用' : '配置密钥'}
          </AsyncButton>
          <AsyncButton
            variant="quiet"
            busy={probing}
            busyLabel="测试中…"
            disabled={!connection.enabled}
            onClick={() => onProbe(connection)}
          >
            测试连接
          </AsyncButton>
        </div>
        {probeResult?.result ? (
          <div
            className={styles['provider-probe-result']!}
            data-testid="provider-probe-result"
            data-state="pass"
          >
            <StatusPill label="连接正常" tone="success" />
            <span>
              耗时 {probeResult.result.latencyMs} ms · {probeResult.result.model ?? '默认模型'}
            </span>
          </div>
        ) : null}
        {probeResult?.error ? (
          <div
            className={styles['provider-probe-result']!}
            data-testid="provider-probe-result"
            data-state="fail"
            role="alert"
          >
            <StatusPill label="连接失败" tone="danger" />
            <span>{probeResult.error}</span>
          </div>
        ) : null}
      </article>
    </SurfaceCard>
  )
}
