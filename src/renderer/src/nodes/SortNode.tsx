import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { ArrowUpDown, Plus, X } from 'lucide-react'
import type { AppNode, SortNodeData, SortKey } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, TOP_RIGHT_ROW_OUT } from './shared/handles'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: SortNodeData }>

function SortNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const { sortKeys = [], inputColumns = [] } = data

  const update = useCallback(
    (patch: Partial<SortNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const addKey = useCallback(() =>
    update({ sortKeys: [...sortKeys, { column: '', direction: 'ASC' }] }),
    [sortKeys, update]
  )
  const removeKey = useCallback((i: number) =>
    update({ sortKeys: sortKeys.filter((_, idx) => idx !== i) }),
    [sortKeys, update]
  )
  const updateKey = useCallback((i: number, patch: Partial<SortKey>) =>
    update({ sortKeys: sortKeys.map((k, idx) => idx === i ? { ...k, ...patch } : k) }),
    [sortKeys, update]
  )

  const hasInput = inputColumns.length > 0
  const isReady  = hasInput && sortKeys.some((k) => k.column)
  const subtitle = isReady
    ? sortKeys.filter((k) => k.column).map((k) => `${k.column} ${k.direction}`).join(', ')
    : hasInput ? 'Add sort keys' : 'No input connected'

  return (
    <PipelineNode selected={selected}>
      <Handle type="target" position={Position.Left} id="row-in"
        style={rowHandle(hasInput, { top: '50%', left: -7 })}
      />
      <Handle type="source" position={Position.Right} id="row-out"
        style={rowHandle(true, TOP_RIGHT_ROW_OUT)}
      />

      <NodeHeader def={sortDef} subtitle={subtitle} />

      <div className="map-table">
        <div className="map-table-header">
          <span style={{ flex: 1 }}>Column</span>
          <span style={{ width: 58 }}>Order</span>
          <span style={{ width: 20 }} />
        </div>

        {sortKeys.map((k, i) => (
          <div key={i} className="map-table-row">
            {hasInput ? (
              <select
                className="node-select map-input"
                style={{ flex: 1 }}
                value={k.column}
                onChange={(e) => updateKey(i, { column: e.target.value })}
                onClick={stopProp} onMouseDown={stopProp}
              >
                <option value="">— column —</option>
                {inputColumns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            ) : (
              <input className="node-input map-input" style={{ flex: 1 }} disabled placeholder="connect input" />
            )}

            <div className="node-toggle-group" style={{ width: 58 }} onClick={stopProp} onMouseDown={stopProp}>
              <button className={`node-toggle-btn${k.direction === 'ASC'  ? ' active' : ''}`} onClick={() => updateKey(i, { direction: 'ASC'  })}>↑</button>
              <button className={`node-toggle-btn${k.direction === 'DESC' ? ' active' : ''}`} onClick={() => updateKey(i, { direction: 'DESC' })}>↓</button>
            </div>

            <button className="map-remove-btn" onClick={() => removeKey(i)} title="Remove">
              <X size={9} strokeWidth={2.5} />
            </button>
          </div>
        ))}

        <button className="map-add-btn" onClick={addKey} onMouseDown={stopProp}>
          <Plus size={10} strokeWidth={2.5} />Add key
        </button>
      </div>

      <div className="status-row">
        <div className={`status-dot ${isReady ? 'ready' : 'pending'}`} />
        <span className="status-text">
          {!hasInput ? 'Connect a row input'
            : !sortKeys.length ? 'Add a sort key'
            : isReady ? `${sortKeys.filter((k) => k.column).length} sort key${sortKeys.length !== 1 ? 's' : ''}`
            : 'Pick a column for each key'}
        </span>
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(SortNode)

// ── Node definition & registration ───────────────────────────────────────────
export const sortDef: NodeDef<SortNodeData> = {
  type: 'sort',
  category: 'operation',
  name: 'Sort',
  desc: 'Order rows by one or more columns',
  Icon: ArrowUpDown,
  help: {
    summary: 'Sorts the row stream by one or more columns. Multiple keys are applied left-to-right (primary → secondary → ...).',
    inputs: 'Row stream (blue square).',
    outputs: 'The same rows in sorted order.',
    tips: [
      'Add multiple keys to break ties: sort by country ASC then salary DESC.',
      'Sort order is preserved by downstream nodes unless another Sort or Aggregate is applied.',
      'NULL values sort last in ASC order and first in DESC order (DuckDB default).',
    ],
  },
  inputPorts:  [{ type: 'row' }],
  outputPorts: [{ type: 'row' }],
  defaultData: () => ({ sortKeys: [], inputColumns: [] }),
  Component: Memoized,
}

registerNode(sortDef)

export default Memoized
