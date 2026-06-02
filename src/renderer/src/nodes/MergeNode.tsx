import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Layers } from 'lucide-react'
import type { AppNode, MergeNodeData } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, colHandle, TOP_RIGHT_ROW_OUT } from './shared/handles'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: MergeNodeData }>

function MergeNode({ id, data, selected }: Props) {
  const { inputColumns = [] } = data
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const hasLeft  = inputColumns.length > 0   // propagated from left side
  const subtitle = hasLeft
    ? `${inputColumns.length} column${inputColumns.length !== 1 ? 's' : ''}`
    : 'Connect two datasets'

  return (
    <PipelineNode selected={selected}>
      {/* Left input — top (first dataset) */}
      <Handle type="target" position={Position.Left} id="row-left"
        style={rowHandle(true, { top: 36, left: -7 })}
      />
      {/* Left input — bottom (second dataset) */}
      <Handle type="target" position={Position.Left} id="row-right"
        style={rowHandle(true, { top: 64, left: -7 })}
      />

      {/* Row output — right center, above column list */}
      <Handle type="source" position={Position.Right} id="row-out"
        style={rowHandle(true, { ...TOP_RIGHT_ROW_OUT, left: 'auto', bottom: 'auto' })}
      />

      <NodeHeader def={mergeDef} id={id} subtitle={subtitle} />

      {/* Column outputs — same as CSVInputNode */}
      {hasLeft && (
        <div className="column-list">
          {inputColumns.map((col) => (
            <div key={col.name} className="column-row">
              <span className="col-name" title={col.name}>{col.name}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={`col-out-${col.name}`}
                onMouseDown={stopProp}
                style={colHandle({ width: 11, height: 11 })}
              />
            </div>
          ))}
        </div>
      )}

      {!hasLeft && (
        <div style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: 11 }}>
          Connect datasets with the same columns
        </div>
      )}

      <div className="status-row">
        <div className={`status-dot ${hasLeft ? 'ready' : 'pending'}`} />
        <span className="status-text">
          {hasLeft ? 'Ready — click to preview' : 'Awaiting both inputs'}
        </span>
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(MergeNode)

// ── Node definition & registration ───────────────────────────────────────────
export const mergeDef: NodeDef<MergeNodeData> = {
  type: 'merge',
  category: 'operation',
  name: 'Merge',
  desc: 'Append two datasets (UNION ALL)',
  Icon: Layers,
  help: {
    summary: 'Appends two row streams into one using SQL UNION ALL. Both inputs must have identical column schemas.',
    inputs: 'Two row streams. Top handle = first dataset; bottom handle = second dataset.',
    outputs: 'One combined row stream containing all rows from both inputs. Per-column outputs reflect the shared schema.',
    tips: [
      'Both inputs must have the same column names and compatible types.',
      'Duplicate rows are kept — this is UNION ALL, not UNION DISTINCT.',
      'Connect the left (top) input first; its schema drives the column list.',
    ],
  },
  inputPorts: [{ type: 'row' }, { type: 'row' }],
  outputPorts: [{ type: 'row' }, { type: 'col' }, { type: 'col' }],
  defaultData: () => ({ inputColumns: [] }),
  Component: Memoized,
}

registerNode(mergeDef)

export default Memoized
