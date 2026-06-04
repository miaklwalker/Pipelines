import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { FileJson } from 'lucide-react'
import type { AppNode, JSONNodeData } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, TOP_RIGHT_ROW_OUT } from './shared/handles'
import { ColumnList } from './shared/columns'

type Props = NodeProps<AppNode & { data: JSONNodeData }>

function JSONInputNode({ id, data, selected }: Props) {
  const { fileName, columns } = data
  const subtitle = fileName || (columns.length > 0
    ? `${columns.length} column${columns.length !== 1 ? 's' : ''}`
    : 'No file loaded')

  return (
    <PipelineNode selected={selected}>
      <Handle
        type="source"
        position={Position.Right}
        id="row-out"
        style={rowHandle(true, { ...TOP_RIGHT_ROW_OUT, left: 'auto', bottom: 'auto' })}
      />

      <NodeHeader def={jsonInputDef} id={id} subtitle={subtitle} />

      <ColumnList columns={columns} />

      {columns.length === 0 && (
        <div style={{ padding: '12px 14px', color: 'var(--text-muted)', fontSize: 11 }}>
          No columns detected
        </div>
      )}
    </PipelineNode>
  )
}

const Memoized = memo(JSONInputNode)

export const jsonInputDef: NodeDef<JSONNodeData> = {
  type: 'json-input',
  category: 'input',
  name: 'JSON File',
  desc: 'Load a JSON array and auto-detect schema',
  //@ts-ignore
  Icon: FileJson,
  help: {
    summary: 'Reads a JSON file that contains an array of objects and auto-detects column names and types using DuckDB.',
    inputs: 'None — this is a source node.',
    outputs: 'Row stream (top-right square handle) and one column output per detected field (green circles).',
    tips: [
      'The file must be a JSON array, for example [{"id": 1}, {"id": 2}].',
      'Click the node to preview the first 50 rows.',
      'Drag from a green column circle to wire a single field to a Destination.',
    ],
  },
  inputPorts: [],
  outputPorts: [{ type: 'row' }, { type: 'col' }],
  defaultData: () => ({ fileName: '', filePath: '', columns: [] }),
  Component: Memoized,
}

registerNode(jsonInputDef)

export default Memoized