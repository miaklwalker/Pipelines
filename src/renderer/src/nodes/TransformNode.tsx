import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { Wand2, Plus, X } from 'lucide-react'
import { v4 as uuid } from 'uuid'
import type { AppNode, TransformNodeData } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle } from './shared/handles'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: TransformNodeData }>

function TransformNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const { expressions = [], keepAll = true, inputColumns = [] } = data

  const update = useCallback(
    (patch: Partial<TransformNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )

  const addExpr = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    update({ expressions: [...expressions, { id: uuid(), alias: '', expr: '' }] })
  }, [expressions, update])

  const removeExpr = useCallback((exprId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    update({ expressions: expressions.filter((x) => x.id !== exprId) })
  }, [expressions, update])

  const updateExpr = useCallback((exprId: string, field: 'alias' | 'expr', val: string) => {
    update({ expressions: expressions.map((x) => x.id === exprId ? { ...x, [field]: val } : x) })
  }, [expressions, update])

  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const hasInput  = inputColumns.length > 0
  const subtitle  = `${expressions.length} expression${expressions.length !== 1 ? 's' : ''}`

  return (
    <PipelineNode selected={selected}>
      <Handle type="target" position={Position.Left} id="row-in"
        style={rowHandle(hasInput, { top: '50%', left: -7 })}
      />
      <Handle type="source" position={Position.Right} id="row-out"
        style={rowHandle(true, { top: '50%', right: -7 })}
      />

      <NodeHeader def={transformDef} id={id} subtitle={subtitle} />

      <div className="node-body">
        <div className="node-body-row">
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11.5, color: 'var(--text-dim)' }}
            onClick={stopProp} onMouseDown={stopProp}
          >
            <input
              type="checkbox"
              checked={keepAll}
              onChange={(e) => update({ keepAll: e.target.checked })}
              style={{ cursor: 'pointer', accentColor: 'var(--blue)' }}
            />
            Keep all input columns
          </label>
        </div>

        <div className="node-divider" />

        <div className="expr-list">
          {expressions.map((expr) => (
            <div key={expr.id} className="expr-item">
              <input
                className="node-input"
                style={{ width: 72, flex: '0 0 72px' }}
                placeholder="alias"
                value={expr.alias}
                onChange={(e) => updateExpr(expr.id, 'alias', e.target.value)}
                onClick={stopProp} onMouseDown={stopProp}
              />
              <input
                className="node-input"
                placeholder="expression"
                value={expr.expr}
                onChange={(e) => updateExpr(expr.id, 'expr', e.target.value)}
                onClick={stopProp} onMouseDown={stopProp}
              />
              <button className="expr-remove" onClick={(e) => removeExpr(expr.id, e)} title="Remove">
                <X size={11} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>

        <button className="node-add-btn" onClick={addExpr}>
          <Plus size={11} strokeWidth={2} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
          Add expression
        </button>
      </div>

      <div className="status-row">
        <div className={`status-dot ${hasInput ? 'ready' : 'pending'}`} />
        <span className="status-text">
          {!hasInput ? 'Connect input' : `${inputColumns.length} cols in`}
        </span>
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(TransformNode)

// ── Node definition & registration ───────────────────────────────────────────
export const transformDef: NodeDef<TransformNodeData> = {
  type: 'transform',
  category: 'operation',
  name: 'Transform',
  desc: 'Compute new columns via SQL expressions',
  Icon: Wand2,
  help: {
    summary: 'Adds computed columns to the row stream using SQL expressions evaluated by DuckDB.',
    inputs: 'One row stream.',
    outputs: 'The same row stream with new computed columns appended (or only the new columns if "Keep all" is off).',
    tips: [
      'Any DuckDB SQL expression works: price * 0.9, upper(name), CASE WHEN…',
      'Reference input columns by name: "revenue" / "units".',
      'Uncheck "Keep all" to output only your computed columns.',
    ],
  },
  inputPorts: [{ type: 'row' }],
  outputPorts: [{ type: 'row' }],
  defaultData: () => ({ expressions: [], keepAll: true, inputColumns: [] }),
  Component: Memoized,
}

registerNode(transformDef)

export default Memoized
