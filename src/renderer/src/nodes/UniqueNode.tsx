import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { Fingerprint } from 'lucide-react'
import type { AppNode, UniqueNodeData } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: UniqueNodeData }>

function UniqueNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const { keyColumn = '', keep = 'first', inputColumns = [] } = data

  const update = useCallback(
    (patch: Partial<UniqueNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const hasInput = inputColumns.length > 0
  const isReady  = hasInput && !!keyColumn
  const subtitle = isReady
    ? `"${keyColumn}" · keep ${keep}`
    : hasInput ? 'Select a key column' : 'No input connected'

  return (
    <div className={`pipeline-node${selected ? ' selected' : ''}`} title="Click to preview">
      {/* Row input */}
      <Handle type="target" position={Position.Left} id="row-in"
        style={{
          top: 36, left: -7, width: 13, height: 13, borderRadius: 3,
          background: hasInput ? 'var(--row-handle)' : '#334155',
          border: `2px solid ${hasInput ? 'var(--blue-dark)' : '#1e293b'}`,
        }}
      />

      {/* Row output — top-right corner */}
      <Handle type="source" position={Position.Right} id="row-out"
        style={{
          top: 0, right: 0, transform: 'translate(50%, -50%)',
          width: 13, height: 13, borderRadius: 3,
          background: 'var(--row-handle)', border: '2px solid var(--blue-dark)',
        }}
      />

      <NodeHeader def={uniqueDef} subtitle={subtitle} />

      <div className="node-body">
        {/* Key column selector */}
        <div className="node-body-row">
          <span className="node-label">Key</span>
          {hasInput ? (
            <select
              className="node-select"
              value={keyColumn}
              onChange={(e) => update({ keyColumn: e.target.value })}
              onClick={stopProp} onMouseDown={stopProp}
            >
              <option value="">— pick column —</option>
              {inputColumns.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          ) : (
            <input className="node-input" disabled placeholder="connect input first" />
          )}
        </div>

        {/* First / Last toggle */}
        <div className="node-body-row">
          <span className="node-label">Keep</span>
          <div className="node-toggle-group" onClick={stopProp} onMouseDown={stopProp}>
            <button
              className={`node-toggle-btn${keep === 'first' ? ' active' : ''}`}
              onClick={() => update({ keep: 'first' })}
            >First</button>
            <button
              className={`node-toggle-btn${keep === 'last' ? ' active' : ''}`}
              onClick={() => update({ keep: 'last' })}
            >Last</button>
          </div>
        </div>
      </div>

      <div className="status-row">
        <div className={`status-dot ${isReady ? 'ready' : 'pending'}`} />
        <span className="status-text">
          {!hasInput ? 'Connect a row input'
            : !keyColumn ? 'Select a key column'
            : `Deduplicate on "${keyColumn}"`}
        </span>
      </div>
    </div>
  )
}

const Memoized = memo(UniqueNode)

// ── Node definition & registration ───────────────────────────────────────────
export const uniqueDef: NodeDef<UniqueNodeData> = {
  type: 'unique',
  category: 'operation',
  name: 'Unique',
  desc: 'Keep first or last row per key',
  Icon: Fingerprint,
  help: {
    summary: 'Deduplicates rows by a key column, keeping either the first or last occurrence of each distinct value. All other columns are preserved.',
    inputs: 'Row stream (blue square).',
    outputs: 'Row stream — one row per unique key value.',
    tips: [
      '"First" keeps the row that appears earliest in the input; "Last" keeps the final occurrence.',
      'Row order is determined by the upstream data — add a Sort node if you need deterministic first/last behaviour.',
      'All columns pass through unchanged; only duplicate rows are dropped.',
    ],
  },
  inputPorts:  [{ type: 'row' }],
  outputPorts: [{ type: 'row' }],
  defaultData: () => ({ keyColumn: '', keep: 'first', inputColumns: [] }),
  Component: Memoized,
}

registerNode(uniqueDef)

export default Memoized
