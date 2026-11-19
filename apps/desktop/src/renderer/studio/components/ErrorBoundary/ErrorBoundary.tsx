import React from 'react'
import { ErrorState } from '@agent2live/design-system'
import styles from './ErrorBoundary.module.scss'

interface ErrorBoundaryState {
  failed: boolean
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  override render(): React.ReactNode {
    if (this.state.failed) {
      return (
        <main className={styles['studio-fatal']!} data-testid="fatal-error">
          <ErrorState
            title="工作台渲染失败"
            description="请刷新窗口。若问题持续，请重启应用。"
            tone="fatal"
            retryLabel="刷新窗口"
            onRetry={() => window.location.reload()}
          />
        </main>
      )
    }
    return this.props.children
  }
}
