import React from 'react'
import { cx } from '../../internal/polymorphic'
import styles from './StageRail.module.scss'

export type StageStatus = 'complete' | 'current' | 'blocked' | 'upcoming'

export interface StageStep {
  id: string
  label: string
  status: StageStatus
}

export interface StageRailProps {
  steps: StageStep[]
  label?: string
  className?: string
}

const MARKERS: Record<StageStatus, string> = {
  complete: '✓',
  current: '●',
  blocked: '!',
  upcoming: '○'
}

export const StageRail: React.FC<StageRailProps> = ({ steps, label = '阶段进度', className }) => {
  return (
    <nav className={cx(styles.stageRail, className)} aria-label={label}>
      <ol>
        {steps.map((step) => (
          <li
            key={step.id}
            className={styles.stageStep}
            data-state={step.status}
            aria-current={step.status === 'current' ? 'step' : undefined}
          >
            <span className={styles.stageMarker} aria-hidden="true">
              {MARKERS[step.status]}
            </span>
            <span className={styles.stageLabel}>{step.label}</span>
          </li>
        ))}
      </ol>
    </nav>
  )
}
