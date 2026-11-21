import React, { useState } from 'react'
import { Popover } from '@agent2live/design-system'
import styles from './WorkbenchMoreMenu.module.scss'

export interface WorkbenchMoreMenuProps {
  onOpenProjectInfo(): void
  onOpenVersionHistory(): void
}

export const WorkbenchMoreMenu: React.FC<WorkbenchMoreMenuProps> = ({
  onOpenProjectInfo,
  onOpenVersionHistory
}) => {
  const [open, setOpen] = useState(false)

  const choose = (action: () => void): void => {
    setOpen(false)
    action()
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      label="更多"
      trigger={
        <button type="button" className={styles['wb3-more-button']!} aria-label="更多">
          <span className={styles['wb3-more-dot']!} aria-hidden="true" />
          <span className={styles['wb3-more-dot']!} aria-hidden="true" />
          <span className={styles['wb3-more-dot']!} aria-hidden="true" />
        </button>
      }
    >
      <div className={styles['wb3-more-menu']!} role="menu" aria-label="更多">
        <button
          type="button"
          role="menuitem"
          aria-label="项目信息"
          className={styles['wb3-more-item']!}
          onClick={() => choose(onOpenProjectInfo)}
        >
          <span className={styles['wb3-more-name']!}>项目信息</span>
          <span className={styles['wb3-more-desc']!}>角色与四套版本号</span>
        </button>
        <button
          type="button"
          role="menuitem"
          aria-label="版本历史"
          className={styles['wb3-more-item']!}
          onClick={() => choose(onOpenVersionHistory)}
        >
          <span className={styles['wb3-more-name']!}>版本历史</span>
          <span className={styles['wb3-more-desc']!}>提示词与立绘分开看</span>
        </button>
      </div>
    </Popover>
  )
}
