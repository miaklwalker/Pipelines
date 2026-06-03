import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { Layers3 } from 'lucide-react'
import type { AppNode, UnnestNodeData } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, TOP_RIGHT_ROW_OUT } from './shared/handles'
import { ColumnList } from './shared/columns'

type Props = NodeProps<AppNode & { data: UnnestNodeData }>

function UnnestNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const { arrayColumn = '', itemColumn = 'item', inputColumns = [] } = data

  const update = useCallback(
    (patch: Partial<UnnestNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const hasInput = inputColumns.length > 0
  const isReady = hasInput && !!arrayColumn
  const outputColumns = isReady
    ? [
        ...inputColumns.filter((c) => c.name !== arrayColumn),
        { name: itemColumn || 'item', type: 'TEXT' },
      ]
    : inputColumns

  const subtitle = isReady
    ? `${arrayColumn} → ${itemColumn}`
    : hasInput ? 'Pick an array column' : 'No input connected'

  return (
    <PipelineNode selected={selected}>
      <Handle type="target" position={Position.Left} id="row-in"
        style={rowHandle(hasInput, { top: 36, left: -7 })}
      />
      <Handle type="source" position={Position.Right} id="row-out"
        style={rowHandle(isReady, TOP_RIGHT_ROW_OUT)}
      />

      <NodeHeader def={unnestDef} id={id} subtitle={subtitle} />

      <div className="node-body">
        <div className="node-body-row">
          <span className="node-label">Array</span>
          {hasInput ? (
            <select
              className="node-select map-input"
              value={arrayColumn}
              onChange={(e) => update({ arrayColumn: e.target.value })}
              onClick={stopProp} onMouseDown={stopProp}
            >
              <option value="">— pick array column —</option>
              {inputColumns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          ) : (
            <input className="node-input" disabled placeholder="connect input first" />
          )}
        </div>
        <div className="node-body-row">
          <span className="node-label">Item</span>
          <input
            className="node-input"
            value={itemColumn}
            onChange={(e) => update({ itemColumn: e.target.value })}
            onClick={stopProp} onMouseDown={stopProp}
            placeholder="item"
          />
        </div>
      </div>

      {isReady && outputColumns.length > 0 && (
        <ColumnList columns={outputColumns} />
      )}

      {!hasInput && (
        <div style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: 11 }}>
          Connect a row input to choose an array column
        </div>
      )}

      <div className="status-row">
        <div className={`status-dot ${isReady ? 'ready' : 'pending'}`} />
        <span className="status-text">
          {!hasInput ? 'Connect a row input'
            : !arrayColumn ? 'Select an array column'
            : `Unnest ${arrayColumn} into rows`}
        </span>
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(UnnestNode)

export const unnestDef: NodeDef<UnnestNodeData> = {
  type: 'unnest',
  category: 'operation',
  name: 'Unnest',
  desc: 'Expand an array column into rows',
  Icon: Layers3,
  help: {
    summary: 'Takes a row stream and explodes one array/list column into a row per element. The current item is exposed as a JSON text column so nested objects are readable downstream.',
    inputs: 'Row stream (blue square).',
    outputs: 'Row stream with the array expanded. All other columns pass through, and the element is available as the item column.',
    tips: [
      'Best for JSON array fields like line_items, items, tags, or any DuckDB list column.',
      'If the array elements are objects, the item column is serialized to JSON text.',
      'Use Destination or JSON functions downstream to pick fields from the item column if needed.',
    ],
  },
  inputPorts: [{ type: 'row' }],
  outputPorts: [{ type: 'row' }, { type: 'col' }],
  defaultData: () => ({ arrayColumn: '', itemColumn: 'item', inputColumns: [] }),
  Component: Memoized,
}

registerNode(unnestDef)

export default Memoized