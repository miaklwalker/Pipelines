import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { Filter } from 'lucide-react'
import type { AppNode, FilterNodeData } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, colHandle } from './shared/handles'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: FilterNodeData }>

function FilterNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const { condition = '', inputColumns = [] } = data

  const update = useCallback(
    (patch: Partial<FilterNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )

  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const hasInput = inputColumns.length > 0
  const isReady  = hasInput && condition.trim().length > 0

  const subtitle = isReady
    ? `${inputColumns.length} col${inputColumns.length !== 1 ? 's' : ''} · ${condition.length > 20 ? condition.slice(0, 20) + '…' : condition}`
    : hasInput ? 'Enter a condition' : 'No input connected'

  return (
    <PipelineNode selected={selected} title="Click to preview (pass branch)">

      {/* ── Left handles ──────────────────────────────────────────────────── */}
      {/* Row input */}
      <Handle type="target" position={Position.Left} id="row-in"
        style={rowHandle(hasInput, { top: 36, left: -7 })}
      />
      {/* Test-value input — connects a scalar row stream used in the condition */}
      <Handle type="target" position={Position.Left} id="val-in"
        style={{
          top: 64, left: -7, width: 11, height: 11, borderRadius: '50%',
          background: '#a855f7', border: '2px solid #7e22ce',
        }}
      />

      {/* ── Right handles — pass (green) and fail (red) ────────────────────── */}
      <Handle type="source" position={Position.Right} id="row-out-pass"
        style={{
          top: 36, right: -7, width: 13, height: 13, borderRadius: 3,
          background: 'var(--green)', border: '2px solid var(--green-dark)',
        }}
      />
      <Handle type="source" position={Position.Right} id="row-out-fail"
        style={{
          top: 64, right: -7, width: 13, height: 13, borderRadius: 3,
          background: 'var(--red)', border: '2px solid rgba(239,68,68,0.6)',
        }}
      />

      <NodeHeader def={filterDef} id={id} subtitle={subtitle} />

      {/* ── Legend for the two sides ──────────────────────────────────────── */}
      <div className="filter-io-legend">
        <div className="filter-io-row">
          <div className="filter-io-dot filter-io-dot-purple" />
          <span>test value</span>
        </div>
        <div style={{ flex: 1 }} />
        <div className="filter-io-row">
          <span>pass</span>
          <div className="filter-io-dot filter-io-dot-green" />
        </div>
        <div className="filter-io-row">
          <span>fail</span>
          <div className="filter-io-dot filter-io-dot-red" />
        </div>
      </div>

      {/* ── Condition field ───────────────────────────────────────────────── */}
      <div className="node-body">
        <div className="node-body-row">
          <span className="node-label">Where</span>
          <input
            className="node-input"
            placeholder="e.g. amount > 100"
            value={condition}
            onChange={(e) => update({ condition: e.target.value })}
            onClick={stopProp}
            onMouseDown={stopProp}
          />
        </div>
        <div style={{ fontSize: 9.5, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.5 }}>
          Use <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>&#39;single quotes&#39;</code> for text values
        </div>
      </div>

      {/* ── Per-column outputs (pass + fail stacked in each row) ──────────── */}
      {hasInput && (
        <div className="column-list">
          {/* Column header */}
          <div style={{
            display: 'flex', alignItems: 'center',
            padding: '2px 14px', borderBottom: '1px solid var(--border)', gap: 4,
          }}>
            <span style={{ flex: 1, fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Column</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--green)', letterSpacing: '0.05em', marginRight: 12 }}>P</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--red)',  letterSpacing: '0.05em', marginRight: 2 }}>F</span>
          </div>

          {inputColumns.map((col) => (
            /*
              Each row is 44px tall so we can vertically stack the two handles:
              pass handle at top:30% ≈ 13px, fail handle at top:70% ≈ 31px.
            */
            <div key={col.name} className="filter-column-row">
              <span className="col-name" title={col.name}>{col.name}</span>

              {/* Pass handle — upper half of the row */}
              <Handle
                type="source"
                position={Position.Right}
                id={`col-out-pass-${col.name}`}
                onMouseDown={stopProp}
                style={colHandle({ top: '30%' })}
              />

              {/* Fail handle — lower half of the row */}
              <Handle
                type="source"
                position={Position.Right}
                id={`col-out-fail-${col.name}`}
                onMouseDown={stopProp}
                style={{
                  top: '70%',
                  width: 9, height: 9, borderRadius: '50%',
                  background: 'var(--red)', border: '2px solid rgba(239,68,68,0.6)',
                }}
              />
            </div>
          ))}
        </div>
      )}

      {!hasInput && (
        <div style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: 11 }}>
          Connect a row input to see columns
        </div>
      )}

      <div className="status-row">
        <div className={`status-dot ${isReady ? 'ready' : hasInput ? 'pending' : 'pending'}`} />
        <span className="status-text">
          {!hasInput
            ? 'Connect a row input'
            : !condition.trim()
              ? 'Enter a filter condition'
              : 'Ready — green = pass, red = fail'}
        </span>
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(FilterNode)

// ── Node definition & registration ───────────────────────────────────────────
export const filterDef: NodeDef<FilterNodeData> = {
  type: 'filter',
  category: 'operation',
  name: 'Filter',
  desc: 'Split rows by a SQL condition',
  Icon: Filter,
  help: {
    summary: 'Tests each row against a SQL WHERE condition. Passing rows exit the green output; failing rows exit the red output.',
    inputs: 'Row stream (square handle). Optional test-value input (purple circle) — connects a single-row scalar dataset whose columns are available inside your condition expression.',
    outputs: 'Green square = rows WHERE condition. Red square = rows WHERE NOT condition. Green/red circles = individual column values from each branch.',
    tips: [
      "Use single quotes for text values: amount > 1000, status = 'active', name IS NOT NULL.",
      'Double quotes mean a column name in SQL — always use single quotes around string literals.',
      'Connect a single-value node to the purple test-value port, then reference its column in your condition.',
      'Click the node to preview the PASS branch (rows that satisfy the condition).',
      'Both outputs can be wired forward independently — split your pipeline into two branches.',
    ],
  },
  inputPorts: [{ type: 'row' }],
  outputPorts: [{ type: 'row' }, { type: 'row' }, { type: 'col' }],
  defaultData: () => ({ condition: '', inputColumns: [] }),
  Component: Memoized,
}

registerNode(filterDef)

export default Memoized
