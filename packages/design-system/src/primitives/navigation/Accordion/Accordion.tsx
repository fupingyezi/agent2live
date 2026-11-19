import React, { useId, useState } from 'react'
import { cx } from '../../../internal/polymorphic'
import styles from './Accordion.module.scss'

export interface AccordionItem {
  id: string
  title: React.ReactNode
  content: React.ReactNode
  disabled?: boolean
}

export interface AccordionProps {
  items: AccordionItem[]
  allowMultiple?: boolean
  className?: string
}

export const Accordion: React.FC<AccordionProps> = ({ items, allowMultiple = false, className }) => {
  const baseId = useId()
  const [open, setOpen] = useState<string[]>([])

  const toggle = (id: string): void => {
    setOpen((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id)
      return allowMultiple ? [...current, id] : [id]
    })
  }

  return (
    <div className={cx(styles.accordion, className)}>
      {items.map((item) => {
        const expanded = open.includes(item.id)
        const buttonId = `${baseId}-button-${item.id}`
        const panelId = `${baseId}-panel-${item.id}`
        return (
          <div
            key={item.id}
            className={styles.accordionItem}
            data-state={expanded ? 'expanded' : 'collapsed'}
          >
            <h3 className={styles.accordionHeading}>
              <button
                id={buttonId}
                type="button"
                className={styles.accordionButton}
                aria-expanded={expanded}
                aria-controls={panelId}
                disabled={item.disabled}
                onClick={() => toggle(item.id)}
              >
                <span>{item.title}</span>
                <span aria-hidden="true">{expanded ? '−' : '+'}</span>
              </button>
            </h3>
            {expanded ? (
              <div id={panelId} role="region" aria-labelledby={buttonId} className={styles.accordionPanel}>
                {item.content}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
