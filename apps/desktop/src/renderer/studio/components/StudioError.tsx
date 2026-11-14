import React from 'react'
import { Button, ErrorState } from '@agent2live/design-system'
import { describeStudioError } from './error-model'

export interface StudioErrorProps {
  error: unknown
  onRetry?: () => void
  onOpenSettings?: () => void
}

export const StudioError: React.FC<StudioErrorProps> = ({ error, onRetry, onOpenSettings }) => {
  const copy = describeStudioError(error)
  const settingsAction =
    copy.showSettings && onOpenSettings ? (
      <Button variant="secondary" onClick={onOpenSettings}>
        打开设置
      </Button>
    ) : undefined

  return (
    <div className="studio-error" data-testid="error-state">
      <ErrorState
        title={copy.title}
        description={copy.description}
        tone={copy.tone}
        {...(copy.code ? { code: copy.code } : {})}
        {...(copy.supportId ? { supportId: copy.supportId } : {})}
        {...(onRetry ? { onRetry } : {})}
        {...(settingsAction ? { actions: settingsAction } : {})}
      />
    </div>
  )
}
