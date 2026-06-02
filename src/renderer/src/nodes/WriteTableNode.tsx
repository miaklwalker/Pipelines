import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { Upload, Loader, CheckCircle, AlertCircle } from 'lucide-react'
import type { AppNode, WriteTableNodeData } from '../lib/types'
import { buildNodeSQL } from '../lib/sqlBuilder'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, connHandle } from './shared/handles'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: WriteTableNodeData }>

function WriteTableNode({ id, data, selected }: Props) {
  const { setNodes, getNodes, getEdges } = useReactFlow()
  const {
    tableName = '', writeMode = 'append',
    status = 'idle', rowCount = null, error, resolvedConfig,
    inputColumns = [],
  } = data

  const update = useCallback(
    (patch: Partial<WriteTableNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const handleWrite = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!resolvedConfig || !tableName) return

    // Build the upstream pipeline SQL using the full graph
    const nodes = getNodes()
    const edges = getEdges()
    const inputEdge = edges.find((ev) => ev.target === id && ev.targetHandle === 'row-in')
    if (!inputEdge) return
    const sql = buildNodeSQL(inputEdge.source, nodes as AppNode[], edges as ReturnType<typeof getEdges>, inputEdge.sourceHandle ?? undefined)
    if (!sql) return

    update({ status: 'writing', error: undefined, rowCount: null })
    try {
      const result = await window.api.pgWrite(resolvedConfig, sql, tableName, writeMode)
      update({ status: 'done', rowCount: result.rowCount })
    } catch (err) {
      update({ status: 'error', error: String(err) })
    }
  }, [id, resolvedConfig, tableName, writeMode, getNodes, getEdges, update])

  const hasInput  = inputColumns.length > 0
  const isConnected = !!resolvedConfig
  const canWrite  = isConnected && !!tableName && hasInput && status !== 'writing'

  const subtitle = status === 'done' ? `${rowCount?.toLocaleString()} rows written`
    : status === 'writing' ? 'Writing…'
    : status === 'error' ? 'Write failed'
    : isConnected ? (tableName ? `→ ${tableName}` : 'Enter table name') : 'Connect a database'

  return (
    <PipelineNode selected={selected} title="Click to preview data">
      {/* conn-in — violet square (left top) */}
      <Handle type="target" position={Position.Left} id="conn-in"
        style={connHandle(isConnected, { top: 36, left: -7 })}
      />

      {/* row-in — blue square (left bottom) */}
      <Handle type="target" position={Position.Left} id="row-in"
        style={rowHandle(hasInput, { top: 64, left: -7 })}
      />

      <NodeHeader def={writeTableDef} id={id} subtitle={subtitle} />

      {/* Port legend */}
      <div className="filter-io-legend">
        <div className="filter-io-row">
          <div style={{ width: 8, height: 8, borderRadius: 2, background: '#7c3aed', border: '1px solid #5b21b6', flexShrink: 0 }} />
          <span>connection</span>
        </div>
        <div className="filter-io-row" style={{ marginLeft: 12 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--row-handle)', border: '1px solid var(--blue-dark)', flexShrink: 0 }} />
          <span>data in</span>
        </div>
      </div>

      <div className="node-body">
        <div className="node-body-row">
          <span className="node-label">Table</span>
          <input
            className="node-input"
            placeholder="target_table"
            value={tableName}
            onChange={(e) => update({ tableName: e.target.value })}
            onClick={stopProp} onMouseDown={stopProp}
          />
        </div>

        <div className="node-body-row">
          <span className="node-label">Mode</span>
          <div className="node-toggle-group" onClick={stopProp} onMouseDown={stopProp}>
            <button className={`node-toggle-btn${writeMode === 'append'  ? ' active' : ''}`} onClick={() => update({ writeMode: 'append'  })}>Append</button>
            <button className={`node-toggle-btn${writeMode === 'replace' ? ' active' : ''}`} onClick={() => update({ writeMode: 'replace' })}>Replace</button>
          </div>
        </div>

        {writeMode === 'replace' && (
          <div className="node-hint" style={{ color: 'var(--orange)', padding: '2px 0 4px' }}>
            Replace truncates the table before inserting.
          </div>
        )}

        <button
          className={`db-fetch-btn${canWrite ? '' : ' disabled'}`}
          onClick={handleWrite}
          disabled={!canWrite}
          style={{ marginTop: 4 }}
        >
          {status === 'writing'
            ? <><Loader size={11} strokeWidth={2} className="spin" />Writing…</>
            : status === 'done'
            ? <><CheckCircle size={11} strokeWidth={2} />Write Again</>
            : <>Write to Database</>}
        </button>

        {error && <div className="db-error-msg">{error}</div>}
      </div>

      <div className="status-row">
        <div className={`status-dot ${status === 'done' ? 'ready' : status === 'error' ? 'error' : 'pending'}`} />
        <span className="status-text">
          {!isConnected ? 'Connect a database node'
            : !hasInput ? 'Connect a data source'
            : !tableName ? 'Enter target table name'
            : status === 'idle' ? 'Ready to write'
            : status === 'writing' ? 'Writing rows…'
            : status === 'done' ? `Wrote ${rowCount?.toLocaleString() ?? '?'} rows`
            : 'Write failed — check error above'}
        </span>
        {status === 'done' && <CheckCircle size={10} strokeWidth={2} style={{ marginLeft: 'auto', color: 'var(--green)' }} />}
        {status === 'error' && <AlertCircle size={10} strokeWidth={2} style={{ marginLeft: 'auto', color: 'var(--red)' }} />}
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(WriteTableNode)

// ── Node definition & registration ───────────────────────────────────────────
export const writeTableDef: NodeDef<WriteTableNodeData> = {
  type: 'write-table',
  category: 'database',
  name: 'Write Table',
  desc: 'Insert pipeline output into Postgres',
  Icon: Upload,
  help: {
    summary: 'Executes the upstream pipeline in DuckDB and inserts the result rows into a PostgreSQL table.',
    inputs: 'Connection (violet square) + row stream (blue square).',
    outputs: 'None — this is a terminal node.',
    tips: [
      '"Append" adds rows to the existing table; "Replace" truncates first.',
      'The target table must already exist with matching column names.',
      'Click the node to preview the data that would be written before committing.',
      'Rows are inserted in batches of 100 for reliability.',
    ],
  },
  inputPorts:  [{ type: 'conn' }, { type: 'row' }],
  outputPorts: [],
  defaultData: () => ({
    tableName: '', writeMode: 'append',
    status: 'idle', rowCount: null, inputColumns: [], resolvedConfig: null,
  }),
  Component: Memoized,
}

registerNode(writeTableDef)

export default Memoized
