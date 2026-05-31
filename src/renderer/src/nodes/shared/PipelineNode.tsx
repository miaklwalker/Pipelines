/**
 * PipelineNode — the outer shell every node renders into.
 *
 * Centralises the .pipeline-node class, the `selected` modifier, and the
 * default "Click to preview" title so every node looks identical without
 * each one copy-pasting the same wrapper div.
 */
import type { ReactNode } from 'react'

interface Props {
  selected: boolean
  children: ReactNode
  /** Tooltip text. Defaults to "Click to preview". */
  title?: string
  /** Extra CSS classes applied to the shell. */
  className?: string
}

export function PipelineNode({ selected, children, title = 'Click to preview', className }: Props) {
  const cls = ['pipeline-node', selected && 'selected', className]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={cls} title={title}>
      {children}
    </div>
  )
}
