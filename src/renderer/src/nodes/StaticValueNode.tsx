import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { Tag } from 'lucide-react'
import type { AppNode, StaticValueData } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: StaticValueData }>

function StaticValueNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const { value = '', columnName = 'value', hasAnchor = false } = data

  const update = useCallback(
    (patch: Partial<StaticValueData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const isReady  = !!(columnName && value !== '')
  const subtitle = isReady ? `"${columnName}" = '${value}'` : 'Configure value'

  return (
    <div className={`pipeline-node${selected ? ' selected' : ''}`} title="Click to preview">
      {/* Anchor input — amber square (special port) */}
      <Handle type="target" position={Position.Left} id="anchor-in"
        style={{
          top: '50%', left: -7, width: 11, height: 11, borderRadius: 2,
          background: hasAnchor ? '#f59e0b' : '#44403c',
          border: `2px solid ${hasAnchor ? '#d97706' : '#292524'}`,
        }}
      />

      {/* Column output — green circle */}
      <Handle type="source" position={Position.Right} id="col-out"
        style={{
          top: '50%', right: -5.5, width: 11, height: 11, borderRadius: '50%',
          background: 'var(--green)', border: '2px solid var(--green-dark)',
        }}
      />

      <NodeHeader def={staticValueDef} subtitle={subtitle} />

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
          <span className="node-label">Value</span>
          <input
            className="node-input"
            placeholder="static text…"
            value={value}
            onChange={(e) => update({ value: e.target.value })}
            onClick={stopProp} onMouseDown={stopProp}
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
          {!columnName ? 'Set a column name'
            : value === '' ? 'Set a value'
            : `Emits '${value}' → ${hasAnchor ? 'anchored' : 'no anchor'}`}
        </span>
      </div>
    </div>
  )
}

const Memoized = memo(StaticValueNode)

// ── Node definition & registration ───────────────────────────────────────────
export const staticValueDef: NodeDef<StaticValueData> = {
  type: 'static-value',
  category: 'emitter',
  name: 'Static Value',
  desc: 'Emit a constant for every row',
  Icon: Tag,
  help: {
    summary: 'Emits a single constant text value as a new column, repeated for every row in the anchor stream.',
    inputs: 'Anchor (amber square) — a row stream that sets the row count. Connect this to whichever table the emitted column should align with.',
    outputs: 'One column output (green circle). Wire this to a Destination column input to override or supply that column\'s value.',
    tips: [
      'Use this to add a constant label to every row, e.g. source = "import_jan".',
      'Connect the anchor to the same CSV you\'re sending to the Destination.',
      'Wire col-out to a Destination\'s col-in handle to override that column\'s value.',
      'For adding a completely new column, connect to a Transform expression instead.',
    ],
  },
  inputPorts: [],
  outputPorts: [{ type: 'col' }],
  defaultData: () => ({ columnName: 'value', value: '', hasAnchor: false }),
  Component: Memoized,
}

registerNode(staticValueDef)

export default Memoized
