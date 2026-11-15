import React, { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  AppFrame,
  Button,
  NavigationRail,
  SearchField,
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
  const [search, setSearch] = useState('')
  const creatingCharacter = location.pathname === '/characters/new'
  const onProviders = location.pathname.startsWith('/settings/providers')
  const currentSection = onProviders ? '设置 / 模型连接' : creatingCharacter ? '角色 / 新建' : '角色'

  return (
    <AppFrame
      navigation={
        <NavigationRail
          label="主导航"
          stacked
          items={[
            {
              id: 'characters',
              label: '角色',
              icon: '人',
              active: !creatingCharacter && !onProviders,
              onSelect: () => navigate('/')
            },
            {
              id: 'pets',
              label: '桌宠',
              icon: '宠',
              disabled: true,
              onSelect: () => undefined
            },
            {
              id: 'agent',
              label: 'Agent',
              icon: 'A',
              disabled: true,
              onSelect: () => undefined
            },
            {
              id: 'models',
              label: '模型库',
              icon: '层',
              disabled: true,
              onSelect: () => undefined
            },
            {
              id: 'providers',
              label: '设置',
              icon: '设',
              active: onProviders,
              onSelect: () => navigate('/settings/providers')
            }
          ]}
        />
      }
    >
      <div className="studio-shell" data-testid="studio-ready" data-sse-status={status}>
        <header className="studio-topbar">
          <div className="studio-topbar-brand">
            <span className="studio-breadcrumb" data-testid="studio-breadcrumb">
              {currentSection}
            </span>
          </div>
          <div className="studio-topbar-actions">
            <form
              className="studio-search"
              role="search"
              onSubmit={(event) => {
                event.preventDefault()
                const query = search.trim()
                navigate(query ? `/?q=${encodeURIComponent(query)}` : '/')
              }}
            >
              <SearchField
                aria-label="搜索角色、项目"
                clearLabel="清空搜索"
                value={search}
                placeholder="搜索角色、项目"
                onValueChange={setSearch}
              />
            </form>
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
          </div>
        </header>
        <div className="studio-content">
          <Outlet />
        </div>
      </div>
    </AppFrame>
  )
}
