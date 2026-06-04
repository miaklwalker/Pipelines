import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { Hash } from 'lucide-react'
import type { AppNode, LimitNodeData } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, HEADER_ROW_IN, TOP_RIGHT_ROW_OUT } from './shared/handles'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: LimitNodeData }>

function LimitNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const { count = 100, offset = 0 } = data

  const update = useCallback(
    (patch: Partial<LimitNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const subtitle = offset > 0 ? `${count} rows (skip ${offset})` : `${count} rows`

  return (
    <PipelineNode selected={selected}>
      <Handle type="target" position={Position.Left} id="row-in"
        style={rowHandle(true, HEADER_ROW_IN)}
      />
      <Handle type="source" position={Position.Right} id="row-out"
        style={rowHandle(true, TOP_RIGHT_ROW_OUT)}
      />

      <NodeHeader def={limitDef} id={id} subtitle={subtitle} />

      <div className="node-body">
        <div className="node-body-row">
          <span className="node-label">Rows</span>
          <input
            className="node-input"
            type="number"
            min={1}
            value={count}
            onChange={(e) => update({ count: Math.max(1, parseInt(e.target.value) || 1) })}
            onClick={stopProp} onMouseDown={stopProp}
          />
        </div>
        <div className="node-body-row">
          <span className="node-label">Skip</span>
          <input
            className="node-input"
            type="number"
            min={0}
            value={offset}
            onChange={(e) => update({ offset: Math.max(0, parseInt(e.target.value) || 0) })}
            onClick={stopProp} onMouseDown={stopProp}
          />
        </div>
      </div>

      <div className="status-row">
        <div className="status-dot ready" />
        <span className="status-text">
          {offset > 0 ? `Rows ${offset + 1}–${offset + count}` : `First ${count} rows`}
        </span>
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(LimitNode)

// ── Node definition & registration ───────────────────────────────────────────
export const limitDef: NodeDef<LimitNodeData> = {
  type: 'limit',
  category: 'operation',
  name: 'Limit',
  desc: 'Keep the first N rows',
  Icon: Hash,
  help: {
    summary: 'Truncates the row stream to at most N rows. An optional Skip offset lets you page through data.',
    inputs: 'Row stream (blue square).',
    outputs: 'Up to N rows, starting at the offset.',
    tips: [
      'Combine with Sort to get "top N" results — e.g. Sort by revenue DESC then Limit 10.',
      'Skip + Rows implements pagination: page 2 of 10 rows = Skip 10, Rows 10.',
      'Limit does not guarantee order unless a Sort node precedes it.',
    ],
  },
  inputPorts:  [{ type: 'row' }],
  outputPorts: [{ type: 'row' }],
  defaultData: () => ({ count: 100, offset: 0 }),
  Component: Memoized,
}

registerNode(limitDef)

export default Memoized
