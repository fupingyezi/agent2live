import React from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  AppFrame,
  Button,
  NavigationRail,
  StatusPill,
  type EmptyProps,
  type StatusTone
} from '@agent2live/design-system'
import type { SseStatus } from '@studio/api'
import { useServerEvents } from '@studio/hooks'

const SSE_LABELS: Record<SseStatus, string> = {
  connecting: '正在连接实时事件',
  open: '实时已连接',
  reconnecting: '实时重连中',
  closed: '实时连接已断开'
}

const SSE_TONES: Record<SseStatus, StatusTone> = {
  connecting: 'neutral',
  open: 'success',
  reconnecting: 'warning',
  closed: 'danger'
}

export const StudioAppShell: React.FC<EmptyProps> = () => {
  const { status, retry } = useServerEvents()
  const location = useLocation()
  const navigate = useNavigate()
  const creatingCharacter = location.pathname === '/characters/new'
  const onProviders = location.pathname.startsWith('/settings/providers')

  return (
    <AppFrame
      navigation={
        <NavigationRail
          label="主导航"
          collapsed
          items={[
            {
              id: 'characters',
              label: '角色',
              icon: '人',
              active: !creatingCharacter && !onProviders,
              onSelect: () => navigate('/')
            },
            {
              id: 'providers',
              label: '模型连接',
              icon: '设',
              active: onProviders,
              onSelect: () => navigate('/settings/providers')
            },
            {
              id: 'new-character',
              label: '新建角色',
              icon: '+',
              active: creatingCharacter,
              onSelect: () => navigate('/characters/new')
            }
          ]}
        />
      }
    >
      <div className="studio-shell" data-testid="studio-ready" data-sse-status={status}>
        <header className="studio-topbar">
          <div className="studio-topbar-brand">
            <span className="studio-wordmark">agent2live</span>
            <span className="studio-local">本地优先</span>
          </div>
          <div className="studio-topbar-actions">
            <div className="studio-sse" data-testid="sse-status">
              <Button
                variant="quiet"
                size="sm"
                onClick={retry}
                aria-label={`实时事件：${SSE_LABELS[status]}。点击重新连接`}
              >
                <StatusPill label={SSE_LABELS[status]} tone={SSE_TONES[status]} />
              </Button>
            </div>
            <Button asChild size="sm">
              <Link to="/characters/new">新建角色</Link>
            </Button>
          </div>
        </header>
        <div className="studio-content">
          <Outlet />
        </div>
      </div>
    </AppFrame>
  )
}
