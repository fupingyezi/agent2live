import React from 'react'

export interface StudioPageTopbarProps {
  breadcrumb: string
  status?: React.ReactNode
  actions?: React.ReactNode
  tone?: 'overview' | 'completion' | 'editor'
}

/** 页面级顶栏，由当前路由拥有并组合面包屑、状态和操作。 */
export const StudioPageTopbar: React.FC<StudioPageTopbarProps> = ({
  breadcrumb,
  status,
  actions,
  tone = 'overview'
}) => {
  return (
    <header className="studio-page-topbar" data-testid="studio-page-topbar" data-tone={tone}>
      <span className="studio-breadcrumb" data-testid="studio-breadcrumb">
        {breadcrumb}
      </span>
      {status || actions ? (
        <div className="studio-page-topbar-actions">
          {status}
          {actions}
        </div>
      ) : null}
    </header>
  )
}
