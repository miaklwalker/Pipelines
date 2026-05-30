import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { Database, Check, X, Plus } from 'lucide-react'
import type { AppNode, DestinationNodeData, ColMapping } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: DestinationNodeData }>

function DestinationNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const { inputColumns = [], colMap = [] } = data
  const hasInput = inputColumns.length > 0

  const update = useCallback(
    (patch: Partial<DestinationNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )

  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  // ── Pass-through column actions ─────────────────────────────────────────────
  const setDestName = useCallback((sourceCol: string, destCol: string) => {
    update({ colMap: colMap.map((m) => m.sourceCol === sourceCol ? { ...m, destCol } : m) })
  }, [colMap, update])

  const toggleIncluded = useCallback((sourceCol: string) => {
    update({ colMap: colMap.map((m) => m.sourceCol === sourceCol ? { ...m, included: !m.included } : m) })
  }, [colMap, update])

  // ── Custom column actions ───────────────────────────────────────────────────
  const customCols = colMap.filter((m) => !m.sourceCol)

  const addCustomCol = useCallback(() => {
    const newCol: ColMapping = { sourceCol: '', destCol: '', included: true, customExpr: '' }
    update({ colMap: [...colMap, newCol] })
  }, [colMap, update])

  /** Update a custom col by its stable uuid-ish key (we use index for now, keyed by destCol) */
  const updateCustomCol = useCallback((idx: number, patch: Partial<ColMapping>) => {
    let customIdx = 0
    update({
      colMap: colMap.map((m) => {
        if (!m.sourceCol) {
          if (customIdx === idx) { customIdx++; return { ...m, ...patch } }
          customIdx++
        }
        return m
      })
    })
  }, [colMap, update])

  const removeCustomCol = useCallback((idx: number) => {
    let customIdx = 0
    update({
      colMap: colMap.filter((m) => {
        if (!m.sourceCol) {
          const keep = customIdx !== idx
          customIdx++
          return keep
        }
        return true
      })
    })
  }, [colMap, update])

  // ── Subtitle ────────────────────────────────────────────────────────────────
  const includedCount = colMap.filter((m) => m.included !== false).length
  const totalCount = colMap.length
  const subtitle = totalCount > 0
    ? `${includedCount} / ${totalCount} columns`
    : hasInput ? 'Add or filter columns' : 'No input connected'

  return (
    <div className={`pipeline-node${selected ? ' selected' : ''}`} title="Click to preview">
      {/* Row input */}
      <Handle type="target" position={Position.Left} id="row-in"
        style={{
          top: '50%', left: -7, width: 13, height: 13, borderRadius: 3,
          background: hasInput ? 'var(--row-handle)' : '#334155',
          border: `2px solid ${hasInput ? 'var(--blue-dark)' : '#1e293b'}`,
        }}
      />
      {/* Row output */}
      <Handle type="source" position={Position.Right} id="row-out"
        style={{
          top: '50%', right: -7, width: 13, height: 13, borderRadius: 3,
          background: 'var(--row-handle)', border: '2px solid var(--blue-dark)',
        }}
      />

      <NodeHeader def={destinationDef} subtitle={subtitle} />

      {/* ── Pass-through columns ─────────────────────────────────────────────── */}
      {hasInput && (
        <div className="column-list">
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', padding: '3px 14px',
            borderBottom: '1px solid var(--border)', gap: 4,
          }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', flex: 1 }}>Source</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', width: 90, textAlign: 'center' }}>Output name</span>
            <span style={{ width: 22 }} />
          </div>

          {inputColumns.map((col) => {
            const mapping: ColMapping = colMap.find((m) => m.sourceCol === col.name)
              ?? { sourceCol: col.name, destCol: col.name, included: true }
            const isExcluded = mapping.included === false

            return (
              <div key={col.name} className="dest-column-row" style={{ opacity: isExcluded ? 0.4 : 1 }}>
                {/* Column emitter input handle */}
                <Handle type="target" position={Position.Left} id={`col-in-${col.name}`}
                  style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', border: '2px solid var(--green-dark)' }}
                />

                {/* Source name (read-only) */}
                <span style={{
                  fontSize: 11, color: 'var(--text-dim)', flex: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  textDecoration: isExcluded ? 'line-through' : 'none',
                }}>
                  {col.name}
                </span>

                {/* Editable output name */}
                <input
                  className="col-rename-input"
                  value={mapping.destCol}
                  title="Click to rename output column"
                  onChange={(e) => setDestName(col.name, e.target.value)}
                  onClick={stopProp} onMouseDown={stopProp}
                  disabled={isExcluded}
                />

                {/* Include / exclude toggle */}
                <button
                  className={`col-toggle ${isExcluded ? 'col-toggle-off' : 'col-toggle-on'}`}
                  title={isExcluded ? 'Include column' : 'Exclude column'}
                  onClick={(e) => { stopProp(e); toggleIncluded(col.name) }}
                  onMouseDown={stopProp}
                >
                  {isExcluded
                    ? <X size={10} strokeWidth={2.5} />
                    : <Check size={10} strokeWidth={2.5} />
                  }
                </button>

                {/* Column output handle */}
                <Handle type="source" position={Position.Right} id={`col-out-${col.name}`}
                  style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', border: '2px solid var(--green-dark)' }}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* ── Custom columns ───────────────────────────────────────────────────── */}
      {customCols.length > 0 && (
        <div className="dest-custom-section">
          <div className="dest-custom-header">
            <span>Custom Columns</span>
            <span style={{ opacity: 0.5, fontSize: 9 }}>SQL expression → name</span>
          </div>
          {customCols.map((m, idx) => (
            <div key={idx} className="dest-custom-row" onMouseDown={stopProp}>
              {/* Col-in handle — accepts emitter wires (only when name is set) */}
              {m.destCol && (
                <Handle
                  type="target" position={Position.Left}
                  id={`col-in-custom-${m.destCol}`}
                  style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', border: '2px solid var(--green-dark)' }}
                />
              )}

              {/* Output name */}
              <input
                className="dest-custom-input dest-custom-name"
                value={m.destCol}
                placeholder="col_name"
                title="Output column name"
                onChange={(e) => updateCustomCol(idx, { destCol: e.target.value })}
                onClick={stopProp}
              />
              <span className="dest-custom-eq">=</span>
              {/* SQL expression (falls back to emitter if one is wired) */}
              <input
                className="dest-custom-input dest-custom-expr"
                value={m.customExpr ?? ''}
                placeholder="expression or wire emitter ↖"
                title="SQL expression (e.g. 'US', price * 1.1, UPPER(name)). Wiring an emitter node overrides this."
                onChange={(e) => updateCustomCol(idx, { customExpr: e.target.value })}
                onClick={stopProp}
              />
              {/* Remove */}
              <button
                className="dest-custom-remove"
                title="Remove custom column"
                onClick={(e) => { stopProp(e); removeCustomCol(idx) }}
              >
                <X size={9} strokeWidth={2.5} />
              </button>
              {/* Col-out handle (only when name is set) */}
              {m.destCol && (
                <Handle type="source" position={Position.Right} id={`col-out-${m.destCol}`}
                  style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', border: '2px solid var(--green-dark)' }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Add column button ─────────────────────────────────────────────────── */}
      <div style={{ padding: '6px 14px', borderTop: colMap.length > 0 ? '1px solid var(--border)' : 'none' }}>
        <button
          className="dest-add-col-btn"
          onClick={(e) => { stopProp(e); addCustomCol() }}
          onMouseDown={stopProp}
        >
          <Plus size={10} strokeWidth={2.5} />
          Add Column
        </button>
      </div>

      {!hasInput && colMap.filter(m => !m.sourceCol).length === 0 && (
        <div style={{ padding: '6px 14px 8px', color: 'var(--text-muted)', fontSize: 11 }}>
          Connect a row input or add custom columns above.
        </div>
      )}

      <div className="status-row">
        <div className={`status-dot ${hasInput || customCols.length > 0 ? 'ready' : 'pending'}`} />
        <span className="status-text">
          {hasInput || customCols.length > 0 ? 'Ready — click to preview' : 'Awaiting input'}
        </span>
      </div>
    </div>
  )
}

const Memoized = memo(DestinationNode)

// ── Node definition & registration ───────────────────────────────────────────
export const destinationDef: NodeDef<DestinationNodeData> = {
  type: 'destination',
  category: 'output',
  name: 'Destination',
  desc: 'Shape output columns: rename, filter, or add new ones',
  Icon: Database,
  help: {
    summary: 'Maps the incoming row stream to a final output schema. Pass through upstream columns (rename/exclude), or create new ones using any SQL expression.',
    inputs: 'One row stream (left square). Emitter nodes (green circles) can override specific column values.',
    outputs: 'A remapped row stream (right square) and per-column handles for each included column.',
    tips: [
      'Edit the "Output name" field to rename a column in the result.',
      'Use the check/cross toggle to include or exclude an upstream column.',
      'Click "+ Add Column" to create a computed column using any SQL expression.',
      'Custom column expressions can reference upstream columns by name, e.g. UPPER("name") or price * 1.1.',
    ],
  },
  inputPorts: [{ type: 'row' }, { type: 'col' }],
  outputPorts: [{ type: 'row' }, { type: 'col' }],
  defaultData: () => ({ label: 'Output', inputColumns: [], colMap: [] }),
  Component: Memoized,
}

registerNode(destinationDef)

export default Memoized
