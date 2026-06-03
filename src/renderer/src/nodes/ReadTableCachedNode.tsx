import { memo, useCallback, useState } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { HardDrive, Loader, CheckCircle, AlertCircle, RefreshCw, Trash2 } from 'lucide-react'
import type { AppNode, ReadTableCachedNodeData } from '../lib/types'
import { propagateColumns } from '../lib/graphUtils'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, colHandle, connHandle, TOP_RIGHT_ROW_OUT } from './shared/handles'
import { typeBadgeClass } from './CSVInputNode'
import { ColumnList } from './shared/columns'
import SchemaTableBrowser from './shared/SchemaTableBrowser'

function quoteIdent(v: string): string {
  return `"${v.replace(/"/g, '""')}"`
}
// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: ReadTableCachedNodeData }>

function ReadTableCachedNode({ id, data, selected }: Props) {
  const { setNodes, getEdges } = useReactFlow()
  const {
    readMode = 'table', tableName = '', customSQL = '',
    csvPath = null, columns = [], rowCount = null,
    status = 'idle', error, resolvedConfig, cacheDate = null,
    dbTables = [], dbSelectedSchema = null, dbSelectedTable = null, dbStatus = 'idle', dbError,
  } = data
  const [dbFilter, setDbFilter] = useState('')

  const update = useCallback(
    (patch: Partial<ReadTableCachedNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const tableQuery = tableName
    ? `SELECT * FROM ${dbSelectedSchema ? `${quoteIdent(dbSelectedSchema)}.` : ''}${quoteIdent(tableName)}`
    : ''
  const query = readMode === 'table' ? tableQuery : customSQL

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
    update({ tableName: table, dbSelectedSchema: schema, dbSelectedTable: table, dbError: undefined, dbStatus: 'idle' })
  }, [update])

  const doFetch = useCallback(async (force: boolean) => {
    if (!resolvedConfig || !query) return
    update({ status: 'fetching', error: undefined })
    try {
      //@ts-ignore
      const result = await window.api.pgFetchCached(resolvedConfig, query, force)
      setNodes((ns) => {
        const updated = ns.map((n) => n.id === id
          ? { ...n, data: { ...n.data, csvPath: result.csvPath, columns: result.columns, rowCount: result.rowCount, status: 'ready', cacheDate: result.cacheDate ?? new Date().toISOString() } }
          : n
        )
        return propagateColumns(updated as AppNode[], getEdges() as ReturnType<typeof getEdges>)
      })
    } catch (err) {
      update({ status: 'error', error: String(err) })
    }
  }, [id, resolvedConfig, query, update, setNodes, getEdges])

  const handleFetch = useCallback((e: React.MouseEvent) => { e.stopPropagation(); doFetch(false) }, [doFetch])
  const handleRefresh = useCallback((e: React.MouseEvent) => { e.stopPropagation(); doFetch(true) }, [doFetch])

  const handleClearCache = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!csvPath) return
    try {
      //@ts-ignore
      await window.api.pgClearCache(csvPath)
      setNodes((ns) => {
        const updated = ns.map((n) => n.id === id
          ? { ...n, data: { ...n.data, csvPath: null, columns: [], rowCount: null, status: 'idle', cacheDate: null } }
          : n
        )
        return propagateColumns(updated as AppNode[], getEdges() as ReturnType<typeof getEdges>)
      })
    } catch (err) { /* ignore */ }
  }, [id, csvPath, setNodes, getEdges])

  const isConnected = !!resolvedConfig
  const isReady = status === 'ready' && !!csvPath
  const isCached = isReady && !!cacheDate
  const canFetch = isConnected && !!query && status !== 'fetching'

  const cacheDateStr = cacheDate
    ? new Date(cacheDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  const subtitle = isReady
    ? (isCached ? `Cached ${cacheDateStr} · ${rowCount?.toLocaleString()} rows` : `${rowCount?.toLocaleString()} rows`)
    : status === 'fetching' ? 'Fetching…'
      : status === 'error' ? 'Fetch error'
        : isConnected ? (query ? 'Click Fetch to load (or use cache)' : 'Select a table or enter SQL')
          : 'Connect a database'

  return (
    <PipelineNode selected={selected}>
      {/* conn-in */}
      <Handle type="target" position={Position.Left} id="conn-in"
        style={connHandle(isConnected, { top: 36, left: -7 })}
      />

      {/* row-out */}
      <Handle type="source" position={Position.Right} id="row-out"
        style={rowHandle(isReady, TOP_RIGHT_ROW_OUT)}
      />

      <NodeHeader def={readTableCachedDef} id={id} subtitle={subtitle} />

      <div className="node-body">
        {/* Mode toggle */}

        {!isCached && (<>
          <div className="node-body-row">
            <span className="node-label">Mode</span>
            <div className="node-toggle-group" onClick={stopProp} onMouseDown={stopProp}>
              <button className={`node-toggle-btn${readMode === 'table' ? ' active' : ''}`} onClick={() => update({ readMode: 'table' })}>Table</button>
              <button className={`node-toggle-btn${readMode === 'sql' ? ' active' : ''}`} onClick={() => update({ readMode: 'sql' })}>SQL</button>
            </div>
          </div>
          {readMode === 'table' ? (
            <>
              <div className="node-body-row">
                <span className="node-label">Table</span>
                <button
                  className="db-fetch-btn"
                  style={{ flex: 1 }}
                  onClick={handleBrowse}
                  onMouseDown={stopProp}
                  disabled={!isConnected || dbStatus === 'browsing'}
                >
                  {dbStatus === 'browsing' ? 'Loading…' : 'Browse Tables'}
                </button>
              </div>
              <div className="node-body-row" style={{ alignItems: 'center' }}>
                <span className="node-label">Selected</span>
                <div className="node-input" style={{ display: 'flex', alignItems: 'center', minHeight: 22 }}>
                  {dbSelectedTable
                    ? `${dbSelectedSchema}.${dbSelectedTable}`
                    : (tableName ? tableName : 'No table selected')}
                </div>
              </div>
              {dbError && <div className="db-error-msg">{dbError}</div>}
              <div onMouseDown={stopProp}>
                <SchemaTableBrowser
                  tables={dbTables}
                  filter={dbFilter}
                  selectedSchema={dbSelectedSchema}
                  selectedTable={dbSelectedTable}
                  filterPlaceholder="schema or table"
                  onFilterChange={setDbFilter}
                  onSelect={handleSelectTable}
                />
              </div>
            </>
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

        </>)}



        {/* Cache badge + controls */}
        {isCached && (
          <div className="db-cache-badge">
            <HardDrive size={10} strokeWidth={2} />
            <span>Cached {cacheDateStr}</span>
            <button className="db-cache-clear" onClick={handleClearCache} title="Clear cache">
              <Trash2 size={9} strokeWidth={2} />
            </button>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className={`db-fetch-btn${canFetch ? '' : ' disabled'}`}
            style={{ flex: 1 }}
            onClick={handleFetch}
            disabled={!canFetch}
          >
            {status === 'fetching'
              ? <><Loader size={11} strokeWidth={2} className="spin" />Loading…</>
              : isCached ? 'Use Cache' : 'Fetch & Cache'}
          </button>
          {isCached && (
            <button
              className="db-fetch-btn"
              style={{ flex: '0 0 auto', padding: '4px 8px' }}
              onClick={handleRefresh}
              disabled={data.status === 'fetching'}
              title="Force re-fetch from database"
            >
              <RefreshCw size={11} strokeWidth={2} />
            </button>
          )}
        </div>

        {error && <div className="db-error-msg">{error}</div>}
      </div>

      {/* Column list */}
      {isReady && columns.length > 0 && (
        <ColumnList columns={columns} />
      )}

      <div className="status-row">
        <div className={`status-dot ${isReady ? 'ready' : status === 'error' ? 'error' : 'pending'}`} />
        <span className="status-text">
          {status === 'ready' ? `${rowCount?.toLocaleString() ?? '?'} rows${isCached ? ' (cached)' : ''}`
            : status === 'fetching' ? 'Fetching from database…'
              : status === 'error' ? 'Fetch failed'
                : !isConnected ? 'Connect a database node'
                  : 'Ready to fetch'}
        </span>
        {isReady && <CheckCircle size={10} strokeWidth={2} style={{ marginLeft: 'auto', color: 'var(--green)' }} />}
        {status === 'error' && <AlertCircle size={10} strokeWidth={2} style={{ marginLeft: 'auto', color: 'var(--red)' }} />}
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(ReadTableCachedNode)

// ── Node definition & registration ───────────────────────────────────────────
export const readTableCachedDef: NodeDef<ReadTableCachedNodeData> = {
  type: 'read-table-cached',
  category: 'database',
  name: 'Read (Cached)',
  desc: 'Fetch once, run from local cache',
  //@ts-ignore
  Icon: HardDrive,
  help: {
    summary: 'Like Read Table, but saves the fetched data to a persistent local CSV. Subsequent pipeline runs use the cache without reconnecting to the database.',
    inputs: 'Connection (violet square).',
    outputs: 'Row stream and per-column handles — same as Read Table.',
    tips: [
      'Ideal for large tables that change infrequently — fetch once, iterate pipeline many times offline.',
      '"Use Cache" loads from the local file without touching the database.',
      'Click the refresh icon to force a new fetch and overwrite the cache.',
      '"Clear Cache" deletes the local CSV — next run will fetch fresh data.',
    ],
  },
  inputPorts: [{ type: 'conn' }],
  outputPorts: [{ type: 'row' }],
  defaultData: () => ({
    readMode: 'table', tableName: '', customSQL: '',
    csvPath: null, columns: [], rowCount: null,
    status: 'idle', resolvedConfig: null, cacheDate: null,
    dbTables: [], dbSelectedSchema: null, dbSelectedTable: null, dbStatus: 'idle', dbError: undefined,
  }),
  Component: Memoized,
}

registerNode(readTableCachedDef)

export default Memoized
