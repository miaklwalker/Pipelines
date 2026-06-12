import { memo, useCallback, useState } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { Upload, Loader, CheckCircle, AlertCircle } from 'lucide-react'
import type { AppNode, WriteTableNodeData } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, connHandle } from './shared/handles'
import SchemaTableBrowser from './shared/SchemaTableBrowser'
import { usePipelineActions } from '../contexts/PipelineActionsContext'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: WriteTableNodeData }>

function WriteTableNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const { runSink } = usePipelineActions()
  const {
    tableName = '', writeMode = 'append',
    status = 'idle', rowCount = null, error, resolvedConfig,
    inputColumns = [],
    dbTables = [], dbSelectedSchema = null, dbStatus = 'idle', dbError,
    writeProgress = null,
  } = data

  const [dbFilter, setDbFilter] = useState('')

  const update = useCallback(
    (patch: Partial<WriteTableNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  // ── Browse tables ────────────────────────────────────────────────────────────
  const handleBrowse = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!resolvedConfig) return
    update({ dbStatus: 'browsing', dbError: undefined })
    try {
      const tables = await window.api.pgListTables(resolvedConfig)
      update({ dbTables: tables, dbStatus: 'idle', dbError: undefined })
    } catch (err) {
      update({ dbStatus: 'error', dbError: (err as Error).message })
    }
  }, [resolvedConfig, update])

  const handleSelectTable = useCallback((schema: string, table: string) => {
    update({
      tableName: table,
      dbSelectedSchema: schema,
      dbStatus: 'idle',
      dbError: undefined,
      // Reset write status so the node is ready to write again
      status: 'idle', error: undefined, rowCount: null,
    })
  }, [update])

  // ── Write — runs this sink through the shared execution engine ──────────────
  // (Same code path as the topbar Run button: SQL build, quoted identifiers,
  // progress events, and status updates all live in one place.)
  const handleWrite = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!resolvedConfig || !tableName) return
    runSink(id)
  }, [id, resolvedConfig, tableName, runSink])

  const hasInput    = inputColumns.length > 0
  const isConnected = !!resolvedConfig
  const canWrite    = isConnected && !!tableName && hasInput && status !== 'writing'
  const isBrowsing  = dbStatus === 'browsing'

  const selectedLabel = dbSelectedSchema ? `${dbSelectedSchema}.${tableName}` : tableName

  const writingLabel = writeProgress
    ? `Writing ${writeProgress.written.toLocaleString()} / ${writeProgress.total.toLocaleString()} rows…`
    : 'Writing…'

  const subtitle = status === 'done'    ? `${rowCount?.toLocaleString()} rows written`
    : status === 'writing'              ? writingLabel
    : status === 'error'                ? 'Write failed'
    : isConnected ? (tableName ? `→ ${selectedLabel}` : 'Select a target table') : 'Connect a database'

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

        {/* ── Table selector ─────────────────────────────────────────────── */}
        <div className="node-body-row">
          <span className="node-label">Table</span>
          <button
            className={`db-fetch-btn${!isConnected || isBrowsing ? ' disabled' : ''}`}
            style={{ flex: 1 }}
            onClick={handleBrowse}
            onMouseDown={stopProp}
            disabled={!isConnected || isBrowsing}
          >
            {isBrowsing
              ? <><Loader size={11} strokeWidth={2} className="spin" />Loading…</>
              : 'Browse Tables'}
          </button>
        </div>

        {/* Selected table display */}
        <div className="node-body-row">
          <span className="node-label">Target</span>
          <div
            className="node-input"
            style={{ display: 'flex', alignItems: 'center', minHeight: 22, color: tableName ? 'var(--text)' : 'var(--text-muted)', fontStyle: tableName ? 'normal' : 'italic' }}
          >
            {tableName ? selectedLabel : 'No table selected'}
          </div>
        </div>

        {dbError && <div className="db-error-msg">{dbError}</div>}

        {/* Schema browser — shown once tables are loaded */}
        {dbTables.length > 0 && (
          <div onMouseDown={stopProp}>
            <SchemaTableBrowser
              tables={dbTables}
              filter={dbFilter}
              selectedSchema={dbSelectedSchema}
              selectedTable={tableName || null}
              filterPlaceholder="schema or table…"
              onFilterChange={setDbFilter}
              onSelect={handleSelectTable}
            />
          </div>
        )}

        {/* ── Write mode ─────────────────────────────────────────────────── */}
        <div className="node-body-row" style={{ marginTop: dbTables.length ? 6 : 0 }}>
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

        {status === 'writing' && (
          <div style={{ marginTop: 5, height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
            {writeProgress && writeProgress.total > 0
              ? <div style={{
                  height: '100%', borderRadius: 2,
                  background: 'var(--blue)',
                  width: `${Math.round((writeProgress.written / writeProgress.total) * 100)}%`,
                  transition: 'width 0.15s ease',
                }} />
              : <div style={{
                  height: '100%', width: '40%', borderRadius: 2,
                  background: 'var(--blue)',
                  animation: 'write-progress-indeterminate 1.2s ease-in-out infinite',
                }} />
            }
          </div>
        )}

        {error && <div className="db-error-msg">{error}</div>}
      </div>

      <div className="status-row">
        <div className={`status-dot ${status === 'done' ? 'ready' : status === 'error' ? 'error' : 'pending'}`} />
        <span className="status-text">
          {!isConnected     ? 'Connect a database node'
            : !hasInput     ? 'Connect a data source'
            : !tableName    ? 'Select or enter target table'
            : status === 'idle'    ? 'Ready to write'
            : status === 'writing' ? writingLabel
            : status === 'done'    ? `Wrote ${rowCount?.toLocaleString() ?? '?'} rows`
            : 'Write failed — check error above'}
        </span>
        {status === 'done'  && <CheckCircle  size={10} strokeWidth={2} style={{ marginLeft: 'auto', color: 'var(--green)' }} />}
        {status === 'error' && <AlertCircle  size={10} strokeWidth={2} style={{ marginLeft: 'auto', color: 'var(--red)' }} />}
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
      'Click "Browse Tables" to load your database schema and select a target table.',
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
    dbTables: [], dbSelectedSchema: null, dbStatus: 'idle',
  }),
  Component: Memoized,
}

registerNode(writeTableDef)

export default Memoized
