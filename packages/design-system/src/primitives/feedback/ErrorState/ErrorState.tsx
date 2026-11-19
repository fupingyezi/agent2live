import React, { useId } from 'react'
import { cx } from '../../../internal/polymorphic'
import styles from './ErrorState.module.scss'
import { Button } from '../../actions/Button'

export interface ErrorStateProps {
  title: React.ReactNode
  description?: React.ReactNode
  code?: string
  supportId?: string
  retryLabel?: string
  onRetry?: () => void
  actions?: React.ReactNode
  tone?: 'retryable' | 'blocked' | 'fatal'
  className?: string
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title,
  description,
  code,
  supportId,
  retryLabel = '重试',
  onRetry,
  actions,
  tone = 'retryable',
  className
}) => {
  const detailsId = useId()
  return (
    <div className={cx(styles.errorState, className)} role="alert" data-state={tone}>
      <div className={styles.errorMark} aria-hidden="true">
        !
      </div>
      <div className={styles.errorCopy}>
        <h2 className={styles.errorTitle}>{title}</h2>
        {description ? <p className={styles.errorDescription}>{description}</p> : null}
        <div className={styles.errorActions}>
          {onRetry ? (
            <Button variant="secondary" onClick={onRetry}>
              {retryLabel}
            </Button>
          ) : null}
          {actions}
        </div>
        {code || supportId ? (
          <details className={styles.errorDetails}>
            <summary>技术详情</summary>
            <dl id={detailsId}>
              {code ? (
                <>
                  <dt>错误码</dt>
                  <dd>
                    <code>{code}</code>
                  </dd>
                </>
              ) : null}
              {supportId ? (
                <>
                  <dt>支持 ID</dt>
                  <dd>
                    <code>{supportId}</code>
                  </dd>
                </>
              ) : null}
            </dl>
          </details>
        ) : null}
      </div>
    </div>
  )
}
