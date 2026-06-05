import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { Fingerprint } from 'lucide-react'
import type { AppNode, UniqueNodeData } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, TOP_RIGHT_ROW_OUT } from './shared/handles'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: UniqueNodeData }>

function UniqueNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()

  // Migrate old single-key saves: keyColumn → keyColumns
  const rawKeys = data.keyColumns
    ?? (data.keyColumn ? [data.keyColumn] : [])
  const { keep = 'first', inputColumns = [] } = data

  const update = useCallback(
    (patch: Partial<UniqueNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const toggleKey = useCallback((col: string) => {
    const next = rawKeys.includes(col)
      ? rawKeys.filter((c) => c !== col)
      : [...rawKeys, col]
    update({ keyColumns: next })
  }, [rawKeys, update])

  const hasInput = inputColumns.length > 0
  const isReady  = hasInput && rawKeys.length > 0

  const keyLabel = rawKeys.length === 0 ? 'none'
    : rawKeys.length === 1 ? `"${rawKeys[0]}"`
    : `${rawKeys.length} cols`

  const subtitle = isReady
    ? `${keyLabel} · keep ${keep}`
    : hasInput ? 'Select key column(s)' : 'No input connected'

  return (
    <PipelineNode selected={selected}>
      <Handle type="target" position={Position.Left} id="row-in"
        style={rowHandle(hasInput, { top: 36, left: -7 })}
      />
      <Handle type="source" position={Position.Right} id="row-out"
        style={rowHandle(true, TOP_RIGHT_ROW_OUT)}
      />

      <NodeHeader def={uniqueDef} id={id} subtitle={subtitle} />

      <div className="node-body">

        {/* Key column pills */}
        <div className="node-body-row" style={{ alignItems: 'flex-start' }}>
          <span className="node-label" style={{ paddingTop: 3 }}>Key</span>
          {hasInput ? (
            <div className="agg-col-pills" onClick={stopProp} onMouseDown={stopProp}>
              {inputColumns.map((col) => (
                <button
                  key={col.name}
                  className={`agg-col-pill${rawKeys.includes(col.name) ? ' active' : ''}`}
                  onClick={() => toggleKey(col.name)}
                  title={col.name}
                >
                  {col.name}
                </button>
              ))}
            </div>
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
          {!hasInput         ? 'Connect a row input'
            : !isReady       ? 'Select at least one key column'
            : rawKeys.length === 1
              ? `Deduplicate on "${rawKeys[0]}"`
              : `Deduplicate on ${rawKeys.length} columns`}
        </span>
      </div>
    </PipelineNode>
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
    summary: 'Deduplicates rows by one or more key columns, keeping either the first or last occurrence of each distinct combination. All other columns are preserved.',
    inputs: 'Row stream (blue square).',
    outputs: 'Row stream — one row per unique key combination.',
    tips: [
      'Click column pills to toggle them in or out of the composite key.',
      '"First" keeps the row that appears earliest in the input; "Last" keeps the final occurrence.',
      'Row order is determined by the upstream data — add a Sort node if you need deterministic first/last behaviour.',
      'All columns pass through unchanged; only duplicate rows are dropped.',
    ],
  },
  inputPorts:  [{ type: 'row' }],
  outputPorts: [{ type: 'row' }],
  defaultData: () => ({ keyColumns: [], keep: 'first', inputColumns: [] }),
  Component: Memoized,
}

registerNode(uniqueDef)

export default Memoized
