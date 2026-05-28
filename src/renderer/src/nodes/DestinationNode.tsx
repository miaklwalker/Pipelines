import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { Database, Check, X } from 'lucide-react'
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

  const setDestName = useCallback((sourceCol: string, destCol: string) => {
    update({ colMap: colMap.map((m) => m.sourceCol === sourceCol ? { ...m, destCol } : m) })
  }, [colMap, update])

  const toggleIncluded = useCallback((sourceCol: string) => {
    update({ colMap: colMap.map((m) => m.sourceCol === sourceCol ? { ...m, included: !m.included } : m) })
  }, [colMap, update])

  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const includedCount = colMap.filter((m) => m.included !== false).length
  const subtitle = hasInput
    ? `${includedCount} / ${inputColumns.length} columns`
    : 'No input connected'

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

      {hasInput && (
        <div className="column-list">
          {/* Column header row */}
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
                {/* Column input handle */}
                <Handle type="target" position={Position.Left} id={`col-in-${col.name}`}
                  style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', border: '2px solid var(--green-dark)' }}
                />

                {/* Source column name (read-only) */}
                <span style={{
                  fontSize: 11, color: 'var(--text-dim)', flex: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  textDecoration: isExcluded ? 'line-through' : 'none',
                }}>
                  {col.name}
                </span>

                {/* Editable output column name */}
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

      {!hasInput && (
        <div style={{ padding: '12px 14px', color: 'var(--text-muted)', fontSize: 11 }}>
          Connect a row input to map columns
        </div>
      )}

      <div className="status-row">
        <div className={`status-dot ${hasInput ? 'ready' : 'pending'}`} />
        <span className="status-text">{hasInput ? 'Ready — click to preview' : 'Awaiting input'}</span>
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
  desc: 'Rename, filter, and reorder columns',
  Icon: Database,
  help: {
    summary: 'Maps the incoming row stream to a final schema: include/exclude columns and rename them.',
    inputs: 'One row stream (left square). Individual column wires (green circles) can override specific column mappings.',
    outputs: 'A remapped row stream (right square) and individual column outputs per mapped column.',
    tips: [
      'Click the column name in "Output name" to rename it in the result.',
      'Use the check/cross button to include or exclude a column.',
      'Excluded columns are greyed out and omitted from the SQL output.',
    ],
  },
  inputPorts: [{ type: 'row' }, { type: 'col' }, { type: 'col' }],
  outputPorts: [{ type: 'row' }, { type: 'col' }, { type: 'col' }],
  defaultData: () => ({ label: 'Output', inputColumns: [], colMap: [] }),
  Component: Memoized,
}

registerNode(destinationDef)

export default Memoized
