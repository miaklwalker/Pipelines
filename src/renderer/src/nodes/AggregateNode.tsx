import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { Sigma, Plus, X } from 'lucide-react'
import { v4 as uuid } from 'uuid'
import type { AppNode, AggregateNodeData, AggItem, AggFunc } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, HEADER_ROW_IN, TOP_RIGHT_ROW_OUT } from './shared/handles'

const AGG_FUNCS: AggFunc[] = ['COUNT', 'COUNT_DISTINCT', 'SUM', 'AVG', 'MIN', 'MAX']
const AGG_LABELS: Record<AggFunc, string> = {
  COUNT: 'COUNT(*)', COUNT_DISTINCT: 'COUNT DISTINCT',
  SUM: 'SUM', AVG: 'AVG', MIN: 'MIN', MAX: 'MAX',
}

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: AggregateNodeData }>

function AggregateNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const { groupBy = [], aggregations = [], inputColumns = [] } = data

  const update = useCallback(
    (patch: Partial<AggregateNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const toggleGroup = useCallback((col: string) => {
    const next = groupBy.includes(col)
      ? groupBy.filter((c) => c !== col)
      : [...groupBy, col]
    update({ groupBy: next })
  }, [groupBy, update])

  const addAgg = useCallback(() =>
    update({ aggregations: [...aggregations, { id: uuid(), func: 'COUNT', column: '', alias: 'count' }] }),
    [aggregations, update]
  )
  const removeAgg = useCallback((aggId: string) =>
    update({ aggregations: aggregations.filter((a) => a.id !== aggId) }),
    [aggregations, update]
  )
  const updateAgg = useCallback((aggId: string, patch: Partial<AggItem>) =>
    update({ aggregations: aggregations.map((a) => a.id === aggId ? { ...a, ...patch } : a) }),
    [aggregations, update]
  )

  const hasInput = inputColumns.length > 0
  const isReady  = hasInput && aggregations.some((a) => a.alias)
  const subtitle = isReady
    ? `${groupBy.length ? `by ${groupBy.join(', ')} · ` : ''}${aggregations.length} agg${aggregations.length !== 1 ? 's' : ''}`
    : hasInput ? 'Add aggregations' : 'No input connected'

  return (
    <PipelineNode selected={selected}>
      <Handle type="target" position={Position.Left} id="row-in"
        style={rowHandle(hasInput, HEADER_ROW_IN)}
      />
      <Handle type="source" position={Position.Right} id="row-out"
        style={rowHandle(true, TOP_RIGHT_ROW_OUT)}
      />

      <NodeHeader def={aggregateDef} id={id} subtitle={subtitle} />

      {/* ── Group By ──────────────────────────────────────────────────────── */}
      {hasInput && (
        <div className="agg-section">
          <div className="agg-section-label">Group by</div>
          <div className="agg-col-pills">
            {inputColumns.map((col) => (
              <button
                key={col.name}
                className={`agg-col-pill${groupBy.includes(col.name) ? ' active' : ''}`}
                onClick={() => toggleGroup(col.name)}
                onMouseDown={stopProp}
                title={col.name}
              >
                {col.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Aggregations ──────────────────────────────────────────────────── */}
      <div className="map-table" style={{ borderTop: hasInput ? '1px solid var(--border)' : undefined }}>
        <div className="map-table-header">
          <span style={{ width: 90 }}>Function</span>
          <span style={{ flex: 1 }}>Column</span>
          <span style={{ flex: 1 }}>Alias</span>
          <span style={{ width: 20 }} />
        </div>

        {aggregations.map((agg) => (
          <div key={agg.id} className="map-table-row">
            <select
              className="node-select map-input"
              style={{ width: 90 }}
              value={agg.func}
              onChange={(e) => updateAgg(agg.id, { func: e.target.value as AggFunc })}
              onClick={stopProp} onMouseDown={stopProp}
            >
              {AGG_FUNCS.map((f) => <option key={f} value={f}>{AGG_LABELS[f]}</option>)}
            </select>

            {agg.func === 'COUNT' ? (
              <span className="agg-star">*</span>
            ) : hasInput ? (
              <select
                className="node-select map-input"
                style={{ flex: 1 }}
                value={agg.column}
                onChange={(e) => updateAgg(agg.id, { column: e.target.value })}
                onClick={stopProp} onMouseDown={stopProp}
              >
                <option value="">— col —</option>
                {inputColumns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            ) : (
              <input className="node-input map-input" style={{ flex: 1 }} disabled placeholder="col" />
            )}

            <input
              className="node-input map-input"
              style={{ flex: 1 }}
              placeholder="alias"
              value={agg.alias}
              onChange={(e) => updateAgg(agg.id, { alias: e.target.value })}
              onClick={stopProp} onMouseDown={stopProp}
            />

            <button className="map-remove-btn" onClick={() => removeAgg(agg.id)} title="Remove">
              <X size={9} strokeWidth={2.5} />
            </button>
          </div>
        ))}

        <button className="map-add-btn" onClick={addAgg} onMouseDown={stopProp}>
          <Plus size={10} strokeWidth={2.5} />Add aggregation
        </button>
      </div>

      <div className="status-row">
        <div className={`status-dot ${isReady ? 'ready' : 'pending'}`} />
        <span className="status-text">
          {!hasInput ? 'Connect a row input'
            : !aggregations.length ? 'Add an aggregation'
            : !isReady ? 'Set an alias for each aggregation'
            : `${groupBy.length} group col${groupBy.length !== 1 ? 's' : ''}, ${aggregations.length} agg${aggregations.length !== 1 ? 's' : ''}`}
        </span>
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(AggregateNode)

// ── Node definition & registration ───────────────────────────────────────────
export const aggregateDef: NodeDef<AggregateNodeData> = {
  type: 'aggregate',
  category: 'operation',
  name: 'Aggregate',
  desc: 'GROUP BY with COUNT, SUM, AVG…',
  Icon: Sigma,
  help: {
    summary: 'Groups rows by selected columns and computes aggregate functions (COUNT, SUM, AVG, MIN, MAX, COUNT DISTINCT). Output contains one row per unique group.',
    inputs: 'Row stream (blue square).',
    outputs: 'One row per group containing the group columns and aggregated values.',
    tips: [
      'Leave Group By empty to aggregate the entire dataset into a single row.',
      'COUNT(*) counts all rows in each group — no column required.',
      'COUNT DISTINCT counts unique non-null values in the chosen column.',
      'Every selected aggregation must have an alias — this becomes the output column name.',
    ],
  },
  inputPorts:  [{ type: 'row' }],
  outputPorts: [{ type: 'row' }],
  defaultData: () => ({ groupBy: [], aggregations: [], inputColumns: [] }),
  Component: Memoized,
}

registerNode(aggregateDef)

export default Memoized
