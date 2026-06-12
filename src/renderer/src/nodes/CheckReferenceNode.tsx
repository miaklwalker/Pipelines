import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { ShieldCheck } from 'lucide-react'
import type { AppNode, CheckReferenceData } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle } from './shared/handles'
import { FilterColumnList } from './shared/columns'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: CheckReferenceData }>

function CheckReferenceNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const {
    fkColumn = '',
    refColumn = '',
    allowNull = true,
    inputColumns = [],
    refColumns = [],
  } = data

  const update = useCallback(
    (patch: Partial<CheckReferenceData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const hasInput = inputColumns.length > 0
  const hasRef   = refColumns.length > 0
  const isReady  = hasInput && hasRef && !!fkColumn && !!refColumn

  const subtitle = isReady
    ? `${fkColumn} → ref.${refColumn}`
    : !hasInput ? 'No row input' : !hasRef ? 'No reference table' : 'Pick key columns'

  return (
    <PipelineNode selected={selected} title="Click to preview (valid branch)">

      {/* ── Left handles — rows to check (top) and reference table (below) ── */}
      <Handle type="target" position={Position.Left} id="row-in"
        style={rowHandle(hasInput, { top: 36, left: -7 })}
      />
      <Handle type="target" position={Position.Left} id="row-ref"
        style={rowHandle(hasRef, {
          top: 64, left: -7,
          ...(hasRef ? { background: '#f59e0b', border: '2px solid #d97706' } : {}),
        })}
      />

      {/* ── Right handles — valid (green) and violations (red) ─────────────── */}
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

      <NodeHeader def={checkReferenceDef} id={id} subtitle={subtitle} />

      {/* ── Input / output legend ──────────────────────────────────────────── */}
      <div className="filter-io-legend">
        <div className="filter-io-row">
          <div className="filter-io-dot" style={{ background: '#f59e0b' }} />
          <span>reference</span>
        </div>
        <div style={{ flex: 1 }} />
        <div className="filter-io-row">
          <span>valid</span>
          <div className="filter-io-dot filter-io-dot-green" />
        </div>
        <div className="filter-io-row">
          <span>missing</span>
          <div className="filter-io-dot filter-io-dot-red" />
        </div>
      </div>

      {/* ── Key configuration ──────────────────────────────────────────────── */}
      <div className="node-body">
        <div className="node-body-row">
          <span className="node-label">FK col</span>
          <select
            className="node-select"
            value={fkColumn}
            onChange={(e) => update({ fkColumn: e.target.value })}
            onClick={stopProp} onMouseDown={stopProp}
            disabled={!hasInput}
          >
            <option value="">— select —</option>
            {inputColumns.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="node-body-row">
          <span className="node-label">Ref col</span>
          <select
            className="node-select"
            value={refColumn}
            onChange={(e) => update({ refColumn: e.target.value })}
            onClick={stopProp} onMouseDown={stopProp}
            disabled={!hasRef}
          >
            <option value="">— select —</option>
            {refColumns.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="node-body-row" style={{ marginTop: 2 }}>
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, color: 'var(--text-dim)' }}
            onClick={stopProp} onMouseDown={stopProp}
          >
            <input
              type="checkbox"
              checked={allowNull}
              onChange={(e) => update({ allowNull: e.target.checked })}
              style={{ cursor: 'pointer', accentColor: 'var(--blue)' }}
            />
            NULL keys are valid
          </label>
        </div>
      </div>

      {/* ── Per-column valid/missing outputs ───────────────────────────────── */}
      <FilterColumnList columns={inputColumns} />

      {!hasInput && (
        <div style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: 11 }}>
          Connect a row input to see columns
        </div>
      )}

      <div className="status-row">
        <div className={`status-dot ${isReady ? 'ready' : 'pending'}`} />
        <span className="status-text">
          {!hasInput ? 'Connect rows to check'
            : !hasRef ? 'Connect the reference table (amber)'
            : !fkColumn || !refColumn ? 'Pick the key columns'
            : `Ready — green = "${fkColumn}" found in ref, red = orphaned`}
        </span>
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(CheckReferenceNode)

// ── Node definition & registration ───────────────────────────────────────────
export const checkReferenceDef: NodeDef<CheckReferenceData> = {
  type: 'check-reference',
  category: 'operation',
  name: 'Check Reference',
  desc: 'Verify foreign keys exist in a reference table',
  Icon: ShieldCheck,
  help: {
    summary: 'Referential-integrity check. Each row\'s foreign-key column (e.g. model_id) is looked up in a reference table\'s key column (e.g. id). Rows whose key exists exit the green output; orphaned rows — keys with no match — exit the red output.',
    inputs: 'Top blue square = rows to check. Amber square = the reference table (the side that must contain the key).',
    outputs: 'Green square = rows whose FK resolves. Red square = violations (orphaned keys). Green/red circles = individual column values from each branch.',
    tips: [
      'Wire the parent table (e.g. models) to the amber reference input.',
      'Columns ending in _id are auto-selected, and an "id" column on the reference side is picked automatically.',
      'Uncheck "NULL keys are valid" to also flag rows where the FK is NULL.',
      'Wire the red output to a CSV Output or Report node to capture violations.',
      'Click the node to preview the valid branch.',
    ],
  },
  inputPorts:  [{ type: 'row' }, { type: 'row' }],
  outputPorts: [{ type: 'row' }, { type: 'row' }, { type: 'col' }],
  defaultData: () => ({
    fkColumn: '', refColumn: '', allowNull: true,
    inputColumns: [], refColumns: [],
  }),
  Component: Memoized,
}

registerNode(checkReferenceDef)

export default Memoized
