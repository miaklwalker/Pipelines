import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { TableProperties, Loader, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react'
import type { AppNode, ReadTableNodeData } from '../lib/types'
import { propagateColumns } from '../lib/graphUtils'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, colHandle, connHandle, TOP_RIGHT_ROW_OUT } from './shared/handles'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: ReadTableNodeData }>

function ReadTableNode({ id, data, selected }: Props) {
  const { setNodes, getNodes, getEdges } = useReactFlow()
  const {
    readMode = 'table', tableName = '', customSQL = '',
    csvPath = null, columns = [], rowCount = null,
    status = 'idle', error, resolvedConfig,
  } = data

  const update = useCallback(
    (patch: Partial<ReadTableNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const query = readMode === 'table'
    ? (tableName ? `SELECT * FROM "${tableName}"` : '')
    : customSQL

  const handleFetch = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!resolvedConfig || !query) return
    update({ status: 'fetching', error: undefined })
    try {
      const result = await window.api.pgFetch(resolvedConfig, query)
      // Update this node's data then re-propagate columns through the graph
      setNodes((ns) => {
        const updated = ns.map((n) => n.id === id
          ? { ...n, data: { ...n.data, csvPath: result.csvPath, columns: result.columns, rowCount: result.rowCount, status: 'ready' } }
          : n
        )
        return propagateColumns(updated as AppNode[], getEdges() as ReturnType<typeof getEdges>)
      })
    } catch (err) {
      update({ status: 'error', error: String(err) })
    }
  }, [id, resolvedConfig, query, update, setNodes, getEdges])

  const isConnected = !!resolvedConfig
  const isReady = status === 'ready' && !!csvPath
  const canFetch  = isConnected && !!query && status !== 'fetching'

  const subtitle = isReady
    ? `${rowCount?.toLocaleString()} rows · ${columns.length} cols`
    : status === 'fetching' ? 'Fetching…'
    : status === 'error' ? 'Fetch error'
    : isConnected ? (query ? 'Click Fetch to load data' : 'Enter table name or SQL')
    : 'Connect a database'

  return (
    <PipelineNode selected={selected}>
      {/* conn-in — violet square (left top) */}
      <Handle type="target" position={Position.Left} id="conn-in"
        style={connHandle(isConnected, { top: 36, left: -7 })}
      />

      {/* row-out — top-right corner, blue square */}
      <Handle type="source" position={Position.Right} id="row-out"
        style={rowHandle(isReady, TOP_RIGHT_ROW_OUT)}
      />

      <NodeHeader def={readTableDef} subtitle={subtitle} />

      <div className="node-body">
        {/* Mode toggle */}
        <div className="node-body-row">
          <span className="node-label">Mode</span>
          <div className="node-toggle-group" onClick={stopProp} onMouseDown={stopProp}>
            <button className={`node-toggle-btn${readMode === 'table' ? ' active' : ''}`} onClick={() => update({ readMode: 'table' })}>Table</button>
            <button className={`node-toggle-btn${readMode === 'sql'   ? ' active' : ''}`} onClick={() => update({ readMode: 'sql'   })}>SQL</button>
          </div>
        </div>

        {readMode === 'table' ? (
          <div className="node-body-row">
            <span className="node-label">Table</span>
            <input
              className="node-input"
              placeholder="table_name"
              value={tableName}
              onChange={(e) => update({ tableName: e.target.value })}
              onClick={stopProp} onMouseDown={stopProp}
            />
          </div>
        ) : (
          <div className="node-body-row" style={{ alignItems: 'flex-start' }}>
            <span className="node-label" style={{ marginTop: 4 }}>SQL</span>
            <textarea
              className="node-input db-sql-area"
              placeholder="SELECT * FROM …"
              value={customSQL}
              rows={3}
              onChange={(e) => update({ customSQL: e.target.value })}
              onClick={stopProp} onMouseDown={stopProp}
            />
          </div>
        )}

        {/* Fetch button */}
        <button
          className={`db-fetch-btn${canFetch ? '' : ' disabled'}`}
          onClick={handleFetch}
          disabled={!canFetch}
        >
          {status === 'fetching'
            ? <><Loader size={11} strokeWidth={2} className="spin" />Fetching…</>
            : status === 'ready'
            ? <><RefreshCw size={11} strokeWidth={2} />Re-fetch</>
            : <>Fetch Data</>}
        </button>

        {error && <div className="db-error-msg">{error}</div>}
      </div>

      {/* Column list */}
      {isReady && columns.length > 0 && (
        <div className="column-list">
          {columns.map((col) => (
            <div key={col.name} className="column-row" style={{ position: 'relative' }}>
              <Handle
                type="source" position={Position.Right}
                id={`col-out-${col.name}`}
                style={colHandle()}
              />
              <span className="col-name" title={col.name}>{col.name}</span>
              <span className="col-type">{col.type}</span>
            </div>
          ))}
        </div>
      )}

      <div className="status-row">
        <div className={`status-dot ${isReady ? 'ready' : status === 'error' ? 'error' : 'pending'}`} />
        <span className="status-text">
          {status === 'ready' ? `${rowCount?.toLocaleString() ?? '?'} rows loaded`
            : status === 'fetching' ? 'Fetching from database…'
            : status === 'error' ? 'Fetch failed'
            : !isConnected ? 'Connect a database node'
            : 'Ready to fetch'}
        </span>
        {isReady && (
          <span style={{ marginLeft: 'auto', fontSize: 9.5, color: 'var(--text-muted)' }}>
            <CheckCircle size={10} strokeWidth={2} style={{ color: 'var(--green)', verticalAlign: 'middle' }} />
          </span>
        )}
        {status === 'error' && (
          <span style={{ marginLeft: 'auto' }}>
            <AlertCircle size={10} strokeWidth={2} style={{ color: 'var(--red)', verticalAlign: 'middle' }} />
          </span>
        )}
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(ReadTableNode)

// ── Node definition & registration ───────────────────────────────────────────
export const readTableDef: NodeDef<ReadTableNodeData> = {
  type: 'read-table',
  category: 'database',
  name: 'Read Table',
  desc: 'Fetch rows from a Postgres table',
  Icon: TableProperties,
  help: {
    summary: 'Connects to PostgreSQL and reads an entire table or custom SQL query. Data is materialized to a local CSV for use in the pipeline.',
    inputs: 'Connection (violet square) — wire from a Connection node.',
    outputs: 'Row stream (blue square) and per-column handles (green circles) after a successful fetch.',
    tips: [
      'Switch to SQL mode to run any SELECT query including JOINs, WHERE clauses, or CTEs.',
      'Each fetch replaces the local copy. Click Re-fetch to pick up upstream changes.',
      'The fetched data is stored as a temp CSV — pipeline SQL runs entirely in DuckDB after the initial load.',
    ],
  },
  inputPorts:  [{ type: 'conn' }],
  outputPorts: [{ type: 'row' }],
  defaultData: () => ({
    readMode: 'table', tableName: '', customSQL: '',
    csvPath: null, columns: [], rowCount: null,
    status: 'idle', resolvedConfig: null,
  }),
  Component: Memoized,
}

registerNode(readTableDef)

export default Memoized
