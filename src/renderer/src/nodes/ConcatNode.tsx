import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Layers } from 'lucide-react'
import type { AppNode, ConcatNodeData } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, TOP_RIGHT_ROW_OUT } from './shared/handles'
import { ColumnList } from './shared/columns'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: ConcatNodeData }>

function ConcatNode({ id, data, selected }: Props) {
  const { inputColumns = [] } = data

  const hasInput = inputColumns.length > 0
  const subtitle = hasInput
    ? `${inputColumns.length} column${inputColumns.length !== 1 ? 's' : ''}`
    : 'Connect two datasets'

  return (
    <PipelineNode selected={selected}>
      <Handle type="target" position={Position.Left} id="row-left"
        style={rowHandle(true, { top: 36, left: -7 })}
      />
      <Handle type="target" position={Position.Left} id="row-right"
        style={rowHandle(true, { top: 64, left: -7 })}
      />

      <Handle type="source" position={Position.Right} id="row-out"
        style={rowHandle(true, { ...TOP_RIGHT_ROW_OUT, left: 'auto', bottom: 'auto' })}
      />

      <NodeHeader def={concatDef} id={id} subtitle={subtitle} />

      <ColumnList columns={inputColumns} />

      {!hasInput && (
        <div style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: 11 }}>
          Append two datasets with identical columns
        </div>
      )}

      <div className="status-row">
        <div className={`status-dot ${hasInput ? 'ready' : 'pending'}`} />
        <span className="status-text">
          {hasInput ? 'Ready — click to preview' : 'Awaiting both inputs'}
        </span>
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(ConcatNode)

// ── Node definition & registration ───────────────────────────────────────────
export const concatDef: NodeDef<ConcatNodeData> = {
  type: 'concat',
  category: 'operation',
  name: 'Concat',
  desc: 'Append two datasets (UNION ALL)',
  Icon: Layers,
  help: {
    summary: 'Appends two row streams into one using SQL UNION ALL. Both inputs must have the same column names and compatible types.',
    inputs: 'Two row streams. Top handle = first dataset; bottom handle = second dataset.',
    outputs: 'One combined row stream containing all rows from both inputs. Per-column outputs reflect the shared schema.',
    tips: [
      'Both inputs should have identical column names and compatible types.',
      'Rows are appended in order: first dataset, then second dataset.',
      'Use this when you want to stack two result sets vertically.',
    ],
  },
  inputPorts: [{ type: 'row' }, { type: 'row' }],
  outputPorts: [{ type: 'row' }, { type: 'col' }],
  defaultData: () => ({ inputColumns: [] }),
  Component: Memoized,
}

registerNode(concatDef)

export default Memoized
