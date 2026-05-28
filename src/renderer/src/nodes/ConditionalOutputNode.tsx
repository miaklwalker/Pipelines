import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { GitBranch, Plus, X } from 'lucide-react'
import type { AppNode, ConditionalOutputData } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: ConditionalOutputData }>

function ConditionalOutputNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const { columnName = 'result', conditions = [], fallback = '', hasAnchor = false } = data

  const update = useCallback(
    (patch: Partial<ConditionalOutputData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const addBranch    = useCallback(() => update({ conditions: [...conditions, { condition: '', output: '' }] }), [conditions, update])
  const removeBranch = useCallback((i: number) => update({ conditions: conditions.filter((_, idx) => idx !== i) }), [conditions, update])
  const updateBranch = useCallback((i: number, field: 'condition' | 'output', val: string) =>
    update({ conditions: conditions.map((c, idx) => idx === i ? { ...c, [field]: val } : c) }),
    [conditions, update]
  )

  const isReady  = !!(columnName && conditions.some((c) => c.condition.trim()))
  const subtitle = isReady
    ? `"${columnName}" · ${conditions.length} branch${conditions.length !== 1 ? 'es' : ''}${fallback ? ' + else' : ''}`
    : 'Configure conditions'

  return (
    <div className={`pipeline-node${selected ? ' selected' : ''}`} title="Click to preview">
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
        style={{
          top: '50%', right: -5.5, width: 11, height: 11, borderRadius: '50%',
          background: 'var(--green)', border: '2px solid var(--green-dark)',
        }}
      />

      <NodeHeader def={conditionalOutputDef} subtitle={subtitle} />

      <div className="node-body">
        <div className="node-body-row">
          <span className="node-label">Column</span>
          <input
            className="node-input"
            placeholder="output col name"
            value={columnName}
            onChange={(e) => update({ columnName: e.target.value })}
            onClick={stopProp} onMouseDown={stopProp}
          />
        </div>
      </div>

      {/* Conditions table */}
      <div className="map-table">
        <div className="map-table-header">
          <span style={{ flex: 2 }}>When</span>
          <span style={{ flex: 1 }}>Output</span>
          <span style={{ width: 20 }} />
        </div>

        {conditions.map((c, i) => (
          <div key={i} className="map-table-row">
            <input
              className="node-input map-input"
              style={{ flex: 2 }}
              placeholder="col = 'val'…"
              value={c.condition}
              onChange={(e) => updateBranch(i, 'condition', e.target.value)}
              onClick={stopProp} onMouseDown={stopProp}
            />
            <input
              className="node-input map-input"
              style={{ flex: 1 }}
              placeholder="value…"
              value={c.output}
              onChange={(e) => updateBranch(i, 'output', e.target.value)}
              onClick={stopProp} onMouseDown={stopProp}
            />
            <button className="map-remove-btn" onClick={() => removeBranch(i)} title="Remove">
              <X size={9} strokeWidth={2.5} />
            </button>
          </div>
        ))}

        <button className="map-add-btn" onClick={addBranch} onMouseDown={stopProp}>
          <Plus size={10} strokeWidth={2.5} />Add branch
        </button>

        {/* Else row */}
        <div className="map-table-row map-else-row">
          <span className="map-else-label">Else</span>
          <input
            className="node-input map-input"
            style={{ flex: 1 }}
            placeholder="fallback value (or NULL)"
            value={fallback}
            onChange={(e) => update({ fallback: e.target.value })}
            onClick={stopProp} onMouseDown={stopProp}
          />
          <span style={{ width: 20 }} />
        </div>
      </div>

      <div className="node-hint">
        Use <code>&#39;single quotes&#39;</code> for text values · branches evaluated top-down
      </div>

      <div className="emitter-legend">
        <span className="emitter-legend-item">
          <span className="emitter-dot emitter-dot-anchor" />anchor
        </span>
        <span className="emitter-legend-item emitter-legend-right">
          col out<span className="emitter-dot emitter-dot-col" />
        </span>
      </div>

      <div className="status-row">
        <div className={`status-dot ${isReady ? 'ready' : 'pending'}`} />
        <span className="status-text">
          {!columnName ? 'Set an output column name'
            : !conditions.length ? 'Add at least one branch'
            : `${conditions.length} branch${conditions.length !== 1 ? 'es' : ''}${fallback ? ` + else` : ''}`}
        </span>
      </div>
    </div>
  )
}

const Memoized = memo(ConditionalOutputNode)

// ── Node definition & registration ───────────────────────────────────────────
export const conditionalOutputDef: NodeDef<ConditionalOutputData> = {
  type: 'conditional-output',
  category: 'emitter',
  name: 'Conditional',
  desc: 'Output value based on conditions',
  Icon: GitBranch,
  help: {
    summary: 'Tests each row against a series of SQL conditions (CASE WHEN). The first matching condition determines the output value; the optional Else catches anything unmatched.',
    inputs: 'Anchor (amber square) — connects a row stream to set the row count context.',
    outputs: 'One column output (green circle). Wire this to a Destination col-in handle.',
    tips: [
      'Branches are evaluated top-to-bottom — only the first match fires.',
      "Use 'single quotes' for text literals: status = 'active', amount > 1000.",
      'Leave Else blank to output NULL for rows that match no branch.',
      'Any column available in the Destination upstream can be referenced in a condition.',
    ],
  },
  inputPorts:  [],
  outputPorts: [{ type: 'col' }],
  defaultData: () => ({ columnName: 'result', conditions: [], fallback: '', hasAnchor: false }),
  Component: Memoized,
}

registerNode(conditionalOutputDef)

export default Memoized
