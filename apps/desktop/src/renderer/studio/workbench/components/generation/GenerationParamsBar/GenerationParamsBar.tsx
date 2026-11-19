import React from 'react'
import type { GenerationDto } from '@studio/api'
import { Button } from '@agent2live/design-system'
import styles from './GenerationParamsBar.module.scss'

export interface GenerationParamsBarProps {
  generation: GenerationDto
  promptVersionNumber: number | null
  providerLabel: string
  onBackToPrompt(): void
  onRegenerate(): void
}

export const GenerationParamsBar: React.FC<GenerationParamsBarProps> = ({
  generation,
  promptVersionNumber,
  providerLabel,
  onBackToPrompt,
  onRegenerate
}) => {
  return (
    <div className={styles['wb3-params-bar']!} data-testid="wb3-generation-params">
      <div className={styles['wb3-params-list']!}>
        <span>参数</span>
        <span>模型 {providerLabel}</span>
        <span>张数 {generation.count} 张</span>
        <span>尺寸 {generation.size}</span>
        <span>种子 {generation.seed === null ? '随机' : generation.seed}</span>
      </div>
      <div className={styles['wb3-params-actions']!}>
        <Button variant="quiet" size="sm" onClick={onBackToPrompt}>
          依据 第 {promptVersionNumber ?? '—'} 版
        </Button>
        <Button variant="secondary" size="sm" onClick={onRegenerate}>
          重新生成
        </Button>
      </div>
    </div>
  )
}
