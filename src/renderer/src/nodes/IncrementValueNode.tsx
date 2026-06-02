import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { ListOrdered } from 'lucide-react'
import type { AppNode, IncrementValueData } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { colHandle } from './shared/handles'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: IncrementValueData }>

function IncrementValueNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const { startAt = 1, columnName = 'index', hasAnchor = false } = data

  const update = useCallback(
    (patch: Partial<IncrementValueData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const isReady  = !!columnName
  const subtitle = isReady ? `"${columnName}" = ${startAt}, ${startAt + 1}, ${startAt + 2}…` : 'Configure'

  return (
    <PipelineNode selected={selected}>
      {/* Anchor input — amber square */}
      <Handle type="target" position={Position.Left} id="anchor-in"
        style={{
          top: '50%', left: -7, width: 11, height: 11, borderRadius: 2,
          background: hasAnchor ? '#f59e0b' : '#44403c',
          border: `2px solid ${hasAnchor ? '#d97706' : '#292524'}`,
        }}
      />

      {/* Column output — green circle */}
      <Handle type="source" position={Position.Right} id="col-out"
        style={colHandle({ top: '50%', right: -5.5, width: 11, height: 11 })}
      />

      <NodeHeader def={incrementValueDef} id={id} subtitle={subtitle} />

      <div className="node-body">
        <div className="node-body-row">
          <span className="node-label">Column</span>
          <input
            className="node-input"
            placeholder="col_name"
            value={columnName}
            onChange={(e) => update({ columnName: e.target.value })}
            onClick={stopProp} onMouseDown={stopProp}
          />
        </div>
        <div className="node-body-row">
          <span className="node-label">Start at</span>
          <input
            className="node-input"
            type="number"
            min={0}
            value={startAt}
            onChange={(e) => update({ startAt: parseInt(e.target.value, 10) || 1 })}
            onClick={stopProp} onMouseDown={stopProp}
            style={{ fontFamily: 'var(--font-mono)' }}
          />
        </div>
      </div>

      {/* Port legend */}
      <div className="emitter-legend">
        <span className="emitter-legend-item">
          <span className="emitter-dot emitter-dot-anchor" />
          anchor
        </span>
        <span className="emitter-legend-item emitter-legend-right">
          col out
          <span className="emitter-dot emitter-dot-col" />
        </span>
      </div>

      <div className="status-row">
        <div className={`status-dot ${isReady ? 'ready' : 'pending'}`} />
        <span className="status-text">
          {!columnName
            ? 'Set a column name'
            : `${startAt}, ${startAt + 1}, ${startAt + 2}… → ${hasAnchor ? 'anchored' : 'no anchor'}`}
        </span>
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(IncrementValueNode)

// ── Node definition & registration ───────────────────────────────────────────
export const incrementValueDef: NodeDef<IncrementValueData> = {
  type: 'increment-value',
  category: 'emitter',
  name: 'Increment',
  desc: 'Emit a sequential integer per row',
  Icon: ListOrdered,
  help: {
    summary: 'Emits an auto-incrementing integer column (1, 2, 3…) using SQL ROW_NUMBER().',
    inputs: 'Anchor (amber square) — a row stream that sets the row count and ordering.',
    outputs: 'One column output (green circle) — wire to a Destination col-in to supply that column.',
    tips: [
      '"Start at" shifts the sequence: startAt=0 gives 0,1,2…; startAt=100 gives 100,101,102…',
      'Row order matches the anchor\'s natural order — use a Transform with ORDER BY upstream to control it.',
      'Great for generating surrogate keys or row IDs.',
    ],
  },
  inputPorts: [],
  outputPorts: [{ type: 'col' }],
  defaultData: () => ({ columnName: 'index', startAt: 1, hasAnchor: false }),
  Component: Memoized,
}

registerNode(incrementValueDef)

export default Memoized
