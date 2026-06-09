import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { Replace } from 'lucide-react'
import type { AppNode, DefaultValueData } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, colHandle, HEADER_ROW_IN, HEADER_ROW_OUT } from './shared/handles'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: DefaultValueData }>

function DefaultValueNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const {
    targetColumn = '',
    defaultValue = '',
    hasRowIn = false,
    hasColIn = false,
    inputColumns = [],
  } = data

  const update = useCallback(
    (patch: Partial<DefaultValueData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const isReady  = !!(targetColumn && (defaultValue !== '' || hasColIn)) && inputColumns.length > 0
  const subtitle = isReady
    ? `"${targetColumn}" → ${hasColIn ? 'wired default' : `'${defaultValue}'`}`
    : 'Configure default'

  return (
    <PipelineNode selected={selected}>
      {/* Row input — blue square at header */}
      <Handle type="target" position={Position.Left} id="row-in"
        style={rowHandle(hasRowIn, HEADER_ROW_IN)}
      />

      {/* Col input — green circle for wired default value */}
      <Handle type="target" position={Position.Left} id="col-in"
        style={colHandle({ top: '67%', left: -5.5, width: 11, height: 11 })}
      />

      {/* Row output — blue square at header */}
      <Handle type="source" position={Position.Right} id="row-out"
        style={rowHandle(true, HEADER_ROW_OUT)}
      />

      <NodeHeader def={defaultValueDef} id={id} subtitle={subtitle} />

      <div className="node-body">
        <div className="node-body-row">
          <span className="node-label">Column</span>
          <input
            className="node-input"
            placeholder="col_name"
            value={targetColumn}
            onChange={(e) => update({ targetColumn: e.target.value })}
            onClick={stopProp} onMouseDown={stopProp}
          />
        </div>

        {!hasColIn && (
          <div className="node-body-row">
            <span className="node-label">Default</span>
            <input
              className="node-input"
              placeholder="fallback value…"
              value={defaultValue}
              onChange={(e) => update({ defaultValue: e.target.value })}
              onClick={stopProp} onMouseDown={stopProp}
            />
          </div>
        )}

        {hasColIn && (
          <div className="node-hint" style={{ marginTop: 2 }}>
            Using wired col-in as default
          </div>
        )}
      </div>

      <div className="status-row">
        <div className={`status-dot ${isReady ? 'ready' : 'pending'}`} />
        <span className="status-text">
          {!hasRowIn ? 'Connect a row input'
            : !targetColumn ? 'Set a target column'
            : !hasColIn && defaultValue === '' ? 'Set a default or wire col-in'
            : `Fill NULLs in "${targetColumn}" → ${hasColIn ? 'wired value' : `'${defaultValue}'`}`}
        </span>
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(DefaultValueNode)

// ── Node definition & registration ───────────────────────────────────────────
export const defaultValueDef: NodeDef<DefaultValueData> = {
  type: 'default-value',
  category: 'operation',
  name: 'Default Value',
  desc: 'Fill NULL column values with a fallback',
  Icon: Replace,
  help: {
    summary: 'Replaces NULL values in a specified column with a fallback. The fallback can be a typed literal or a column value wired in from any emitter node (Static Value, Increment, etc.).',
    inputs: 'Row stream (blue square). Optional col-in (green circle) — when wired, the emitter\'s value is used as the fallback instead of the typed literal.',
    outputs: 'The same row stream with NULLs in the target column replaced.',
    tips: [
      'Wire a Static Value node to col-in for a constant text fallback.',
      'Wire an Increment node to col-in for a row-number fallback.',
      'Leave col-in unwired and type a literal in "Default" to keep it simple.',
      'Use single quotes for text literals: \'unknown\'.',
    ],
  },
  inputPorts:  [{ type: 'row' }, { type: 'col' }],
  outputPorts: [{ type: 'row' }],
  defaultData: () => ({ targetColumn: '', defaultValue: '', hasRowIn: false, hasColIn: false, inputColumns: [] }),
  Component: Memoized,
}

registerNode(defaultValueDef)

export default Memoized
