import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { FileText } from 'lucide-react'
import type { AppNode, CSVNodeData } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'

// ── Type badge ────────────────────────────────────────────────────────────────
function typeBadgeClass(type: string): string {
  const t = type.toLowerCase()
  if (t === 'integer')   return 'type-integer'
  if (t === 'float')     return 'type-float'
  if (t === 'text')      return 'type-text'
  if (t === 'boolean')   return 'type-boolean'
  if (t === 'date')      return 'type-date'
  if (t === 'timestamp') return 'type-timestamp'
  return 'type-default'
}

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: CSVNodeData }>

function CSVInputNode({ data, selected }: Props) {
  const { fileName, columns } = data
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const subtitle = fileName || (columns.length > 0
    ? `${columns.length} column${columns.length !== 1 ? 's' : ''}`
    : 'No file loaded')

  return (
    <div className={`pipeline-node${selected ? ' selected' : ''}`} title="Click to preview">
      {/*
        Row-stream output — square pinned to the TOP-RIGHT corner.
        position=Right so edges route rightward; top/right + transform straddle the corner.
      */}
      <Handle
        type="source"
        position={Position.Right}
        id="row-out"
        style={{
          top: 0, right: 0, left: 'auto', bottom: 'auto',
          transform: 'translate(50%, -50%)',
          width: 13, height: 13, borderRadius: 3,
          background: 'var(--row-handle)', border: '2px solid var(--blue-dark)',
        }}
      />

      <NodeHeader def={csvInputDef} subtitle={subtitle} />

      <div className="column-list">
        {columns.map((col) => (
          <div key={col.name} className="column-row">
            <span className="col-name" title={col.name}>{col.name}</span>
            <span className={`col-type-badge ${typeBadgeClass(col.type)}`}>{col.type}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={`col-out-${col.name}`}
              onMouseDown={stopProp}
              style={{
                width: 11, height: 11, borderRadius: '50%',
                background: 'var(--green)', border: '2px solid var(--green-dark)',
              }}
            />
          </div>
        ))}
      </div>

      {columns.length === 0 && (
        <div style={{ padding: '12px 14px', color: 'var(--text-muted)', fontSize: 11 }}>
          No columns detected
        </div>
      )}
    </div>
  )
}

const Memoized = memo(CSVInputNode)

// ── Node definition & registration ───────────────────────────────────────────
export const csvInputDef: NodeDef<CSVNodeData> = {
  type: 'csv-input',
  category: 'input',
  name: 'CSV File',
  desc: 'Load & auto-detect schema',
  Icon: FileText,
  help: {
    summary: 'Reads a CSV file and auto-detects column names and data types using DuckDB.',
    inputs: 'None — this is a source node.',
    outputs: 'Row stream (top-right square handle) and one column output per detected column (green circles).',
    tips: [
      'Click the node to preview the first 50 rows.',
      'Types are inferred from the data: INTEGER, FLOAT, TEXT, DATE, TIMESTAMP…',
      'Drag from a green column circle to wire a single column to a Destination.',
    ],
  },
  inputPorts: [],
  outputPorts: [{ type: 'row' }, { type: 'col' }, { type: 'col' }, { type: 'col' }],
  defaultData: () => ({ fileName: '', filePath: '', columns: [] }),
  Component: Memoized,
}

registerNode(csvInputDef)

export default Memoized
