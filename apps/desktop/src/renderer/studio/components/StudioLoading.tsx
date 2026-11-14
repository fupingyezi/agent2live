import React from 'react'
import { Spinner } from '@agent2live/design-system'

export interface StudioLoadingProps {
  label?: string
}

export const StudioLoading: React.FC<StudioLoadingProps> = ({ label = '正在加载…' }) => {
  return (
    <div className="studio-loading" data-testid="studio-loading">
      <Spinner label={label} />
      <p>{label}</p>
    </div>
  )
}
