import React from 'react'
import { AsyncButton, Button, SectionHeader, StatusPill, SurfaceCard } from '@agent2live/design-system'
import type { ProviderConnectionDto, ProviderProbeDto } from '@studio/api'
import { formatDateTime } from '@studio/format'
import { providerCounts, providerDisplayName } from '@studio/providers'
import styles from './ProvidersPage.module.scss'

export interface ProviderProbeState {
  result?: ProviderProbeDto
  error?: string
}

export interface ProviderCardProps {
  connection: ProviderConnectionDto
  refreshing: boolean
  toggling: boolean
  probing: boolean
  probeResult: ProviderProbeState | undefined
  onEdit(connection: ProviderConnectionDto): void
  onRefresh(connection: ProviderConnectionDto): void
  onToggle(connection: ProviderConnectionDto): void
  onProbe(connection: ProviderConnectionDto): void
}

export const ProviderCard: React.FC<ProviderCardProps> = ({
  connection,
  refreshing,
  toggling,
  probing,
  probeResult,
  onEdit,
  onRefresh,
  onToggle,
  onProbe
}) => {
  const counts = providerCounts(connection)
  const canToggle = connection.adapter === 'mock' || connection.hasSecret

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
            {connection.label.slice(0, 1)}
          </span>
          <SectionHeader
            title={connection.label}
            description={`${providerDisplayName(connection)} · 对话 ${counts.chat} · 视觉 ${counts.vision} · 生图 ${counts.image}`}
            actions={
              <StatusPill
                label={connection.enabled ? '已启用' : '已停用'}
                tone={connection.enabled ? 'success' : 'neutral'}
              />
            }
          />
        </div>
        <dl className={styles['provider-meta']!}>
          {connection.baseUrl ? (
            <>
              <dt>Base URL</dt>
              <dd>
                <code>{connection.baseUrl}</code>
              </dd>
            </>
          ) : null}
          <dt>密钥</dt>
          <dd
            className={styles['provider-secret-state']!}
            data-testid="provider-secret-state"
            data-has-secret={connection.hasSecret ? 'true' : 'false'}
          >
            {connection.adapter === 'mock' ? '无需密钥' : connection.hasSecret ? '已保存' : '未配置'}
          </dd>
          <dt>模型目录</dt>
          <dd data-testid="provider-model-catalog">
            {connection.models.length} 个模型
            {connection.modelsRefreshedAt ? ` · 刷新于 ${formatDateTime(connection.modelsRefreshedAt)}` : ''}
          </dd>
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
          {connection.adapter === 'mock' ? null : (
            <AsyncButton
              variant="secondary"
              data-testid="provider-refresh-models"
              busy={refreshing}
              busyLabel="刷新中…"
              disabled={!connection.hasSecret}
              onClick={() => onRefresh(connection)}
            >
              刷新模型目录
            </AsyncButton>
          )}
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
