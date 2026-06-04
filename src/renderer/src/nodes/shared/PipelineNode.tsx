/**
 * PipelineNode — the outer shell every node renders into.
 *
 * Beyond its original role (shared class + selected state), it now:
 *  1. Hosts the per-node collapse context so NodeHeader and ColumnList can
 *     communicate without prop-drilling through every individual node file.
 *  2. Reads the NodeColorContext to render the accent stripe and header tint.
 */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
  type CSSProperties,
} from 'react'
import { useNodeId, useReactFlow } from '@xyflow/react'
import { useNodeColors } from '../../contexts/NodeColorContext'

// ── Per-node collapse context ─────────────────────────────────────────────────

interface CollapseCtxValue {
  collapsed: boolean
  /** True once a ColumnList with >0 columns has mounted under this node */
  hasColumnList: boolean
  toggle: () => void
  /** Called by ColumnList on mount (with columns) */
  register: () => void
  /** Called by ColumnList on unmount or when columns become empty */
  unregister: () => void
}

const NodeCollapseContext = createContext<CollapseCtxValue>({
  collapsed: false,
  hasColumnList: false,
  toggle: () => {},
  register: () => {},
  unregister: () => {},
})

export function useNodeCollapse() {
  return useContext(NodeCollapseContext)
}

// ── Color helpers ─────────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

/** CSS gradient string for the 3-px top stripe */
function makeStripeGradient(colors: string[]): string {
  if (colors.length === 1) return colors[0]
  const pct = (i: number) => Math.round((i * 100) / (colors.length - 1))
  return `linear-gradient(to right, ${colors.map((c, i) => `${c} ${pct(i)}%`).join(', ')})`
}

/** Subtle translucent gradient overlaid on the node header background */
function makeHeaderTint(colors: string[]): string {
  if (colors.length === 1) {
    const c = hexToRgba(colors[0], 0.18)
    return `linear-gradient(90deg, ${c} 0%, transparent 65%)`
  }
  const stops = colors
    .map((c, i) => {
      const pct = Math.round((i * 100) / (colors.length - 1))
      return `${hexToRgba(c, 0.18)} ${pct}%`
    })
    .join(', ')
  return `linear-gradient(90deg, ${stops})`
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  selected: boolean
  children: ReactNode
  /** Tooltip text. Defaults to "Click to preview". */
  title?: string
  /** Extra CSS classes applied to the shell. */
  className?: string
}

export function PipelineNode({ selected, children, title = 'Click to preview', className }: Props) {
  // Collapse state — persisted in node data so it survives save/load.
  // Reading via getNode() is safe here because React Flow re-renders nodes
  // when their data changes, so `collapsed` is always fresh.
  const id = useNodeId() ?? ''
  const { getNode, setNodes } = useReactFlow()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collapsed = ((getNode(id)?.data ?? {}) as any).columnsCollapsed ?? false

  const toggle = useCallback(() => {
    setNodes((ns) =>
      ns.map((n) =>
        n.id === id
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ? { ...n, data: { ...n.data, columnsCollapsed: !(n.data as any).columnsCollapsed } }
          : n
      )
    )
  }, [id, setNodes])

  // hasColumnList is transient UI — no need to persist
  const [hasColumnList, setHasColumnList] = useState(false)

  const register   = useCallback(() => setHasColumnList(true),  [])
  const unregister = useCallback(() => setHasColumnList(false), [])

  // Color accent — read from the app-level color context
  const { displayColors } = useNodeColors()
  const colors = displayColors[id] ?? []

  const stripeGradient = colors.length ? makeStripeGradient(colors) : null
  const headerTint     = colors.length ? makeHeaderTint(colors)     : null

  const cls = ['pipeline-node', selected && 'selected', className]
    .filter(Boolean)
    .join(' ')

  const style = headerTint
    ? ({ '--node-accent-hdr': headerTint } as CSSProperties)
    : undefined

  return (
    <NodeCollapseContext.Provider value={{ collapsed, hasColumnList, toggle, register, unregister }}>
      <div className={cls} title={title} style={style}>
        {stripeGradient && (
          <div className="node-accent-stripe" style={{ background: stripeGradient }} />
        )}
        {children}
      </div>
    </NodeCollapseContext.Provider>
  )
}
