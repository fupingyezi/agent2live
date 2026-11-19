import React from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  AppFrame,
  NavigationRail,
  StatusPill,
  type EmptyProps,
  type StatusTone
} from '@agent2live/design-system'
import type { SseStatus } from '@studio/api'
import { useServerEvents } from '@studio/hooks'
import agentIcon from '@studio/assets/navigation/agent.png'
import brandIcon from '@studio/assets/navigation/brand.png'
import charactersIcon from '@studio/assets/navigation/characters.png'
import modelsIcon from '@studio/assets/navigation/models.png'
import petsIcon from '@studio/assets/navigation/pets.png'
import settingsIcon from '@studio/assets/navigation/settings.png'

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
  const { status } = useServerEvents()
  const location = useLocation()
  const navigate = useNavigate()
  const onProviders = location.pathname.startsWith('/settings/providers')

  return (
    <AppFrame
      navigation={
        <NavigationRail
          label="主导航"
          stacked
          brand={<img src={brandIcon} alt="" data-testid="studio-nav-brand" />}
          items={[
            {
              id: 'characters',
              label: '角色',
              icon: <img src={charactersIcon} alt="" />,
              active: !onProviders,
              onSelect: () => navigate('/')
            },
            {
              id: 'pets',
              label: '桌宠',
              icon: <img src={petsIcon} alt="" />,
              disabled: true,
              onSelect: () => undefined
            },
            {
              id: 'agent',
              label: 'Agent',
              icon: <img src={agentIcon} alt="" />,
              disabled: true,
              onSelect: () => undefined
            },
            {
              id: 'models',
              label: '模型库',
              icon: <img src={modelsIcon} alt="" />,
              disabled: true,
              onSelect: () => undefined
            },
            {
              id: 'providers',
              label: '设置',
              icon: <img src={settingsIcon} alt="" />,
              active: onProviders,
              onSelect: () => navigate('/settings/providers')
            }
          ]}
        />
      }
    >
      <div className="studio-shell" data-testid="studio-ready" data-sse-status={status}>
        <span className="studio-sr-only" data-testid="studio-global-status" aria-live="polite">
          <StatusPill label={SSE_LABELS[status]} tone={SSE_TONES[status]} />
        </span>
        <div className="studio-content">
          <Outlet />
        </div>
      </div>
    </AppFrame>
  )
}
