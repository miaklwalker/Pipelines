import { memo, useCallback, useMemo } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { LayoutGrid, Loader, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react'
import type { AppNode, BrowseSchemaNodeData } from '../lib/types'
import { propagateColumns } from '../lib/graphUtils'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, colHandle, connHandle, TOP_RIGHT_ROW_OUT } from './shared/handles'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: BrowseSchemaNodeData }>

function BrowseSchemaNode({ id, data, selected }: Props) {
  const { setNodes, getEdges } = useReactFlow()
  const {
    tables = [], selectedSchema = null, selectedTable = null,
    filter = '', csvPath = null, columns = [], rowCount = null,
    status = 'idle', error, resolvedConfig,
  } = data

  const update = useCallback(
    (patch: Partial<BrowseSchemaNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const isConnected = !!resolvedConfig
  const isReady = status === 'ready' && !!csvPath
  const isBusy = status === 'browsing' || status === 'fetching'

  // Fetch schema list from the connected database
  const handleBrowse = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!resolvedConfig) return
    update({ status: 'browsing', error: undefined })
    try {
      const tableList = await window.api.pgListTables(resolvedConfig)
      // Preserve 'ready' if a table was already fetched; otherwise go idle (pick a table)
      setNodes((ns) => ns.map((n) => {
        if (n.id !== id) return n
        const d = n.data as BrowseSchemaNodeData
        return { ...n, data: { ...d, tables: tableList, status: d.csvPath ? 'ready' : 'idle', error: undefined } }
      }))
    } catch (err) {
      update({ status: 'error', error: String(err) })
    }
  }, [resolvedConfig, update, setNodes, id])

  // Click a table in the list → fetch its data into a local CSV
  const handleSelectTable = useCallback(async (e: React.MouseEvent, schema: string, name: string) => {
    e.stopPropagation()
    if (!resolvedConfig) return
    update({ selectedSchema: schema, selectedTable: name, status: 'fetching', error: undefined })
    const query = `SELECT * FROM "${schema}"."${name}"`
    try {
      const result = await window.api.pgFetch(resolvedConfig, query)
      setNodes((ns) => {
        const updated = ns.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, csvPath: result.csvPath, columns: result.columns, rowCount: result.rowCount, status: 'ready' } }
            : n
        )
        return propagateColumns(updated as AppNode[], getEdges() as ReturnType<typeof getEdges>)
      })
    } catch (err) {
      update({ status: 'error', error: String(err) })
    }
  }, [resolvedConfig, update, id, setNodes, getEdges])

  // Filter + group the table list
  const filteredTables = useMemo(() => {
    const q = filter.toLowerCase()
    return q ? tables.filter((t) => `${t.schema}.${t.name}`.toLowerCase().includes(q)) : tables
  }, [tables, filter])

  const grouped = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const t of filteredTables) {
      if (!map.has(t.schema)) map.set(t.schema, [])
      map.get(t.schema)!.push(t.name)
    }
    return map
  }, [filteredTables])

  const subtitle = isReady
    ? `${selectedSchema}.${selectedTable} · ${rowCount?.toLocaleString()} rows`
    : status === 'browsing' ? 'Loading schema…'
    : status === 'fetching' ? 'Fetching table…'
    : status === 'error' ? 'Error'
    : tables.length > 0 ? 'Select a table below'
    : isConnected ? 'Click Browse to load schema'
    : 'Connect a database'

  return (
    <PipelineNode selected={selected}>
      {/* conn-in — violet square (left, top) */}
      <Handle type="target" position={Position.Left} id="conn-in"
        style={connHandle(isConnected, { top: 36, left: -7 })}
      />

      {/* row-out — top-right corner */}
      <Handle type="source" position={Position.Right} id="row-out"
        style={rowHandle(isReady, TOP_RIGHT_ROW_OUT)}
      />

      <NodeHeader def={browseSchemaNodeDef} subtitle={subtitle} />

      <div className="node-body">
        {/* Browse / Refresh button */}
        <button
          className={`db-fetch-btn${isConnected && !isBusy ? '' : ' disabled'}`}
          onClick={handleBrowse}
          disabled={!isConnected || isBusy}
        >
          {status === 'browsing'
            ? <><Loader size={11} strokeWidth={2} className="spin" />Loading schema…</>
            : tables.length > 0
            ? <><RefreshCw size={11} strokeWidth={2} />Refresh Schema</>
            : <>Browse Schema</>}
        </button>

        {error && <div className="db-error-msg">{error}</div>}

        {/* Search filter */}
        {tables.length > 0 && (
          <input
            className="node-input schema-filter"
            placeholder="Filter tables…"
            value={filter}
            onChange={(e) => update({ filter: e.target.value })}
            onClick={stopProp}
            onMouseDown={stopProp}
          />
        )}

        {/* Schema / table tree */}
        {grouped.size > 0 && (
          <div className="schema-browser" onMouseDown={stopProp}>
            {[...grouped.entries()].map(([schema, names]) => (
              <div key={schema} className="schema-group">
                <div className="schema-group-title">{schema}</div>
                {names.map((name) => {
                  const isSel = selectedSchema === schema && selectedTable === name
                  return (
                    <div
                      key={name}
                      className={`schema-table-row${isSel ? ' selected' : ''}`}
                      onClick={(e) => handleSelectTable(e, schema, name)}
                    >
                      <span className="schema-table-name">{name}</span>
                      {isSel && status === 'ready' && (
                        <CheckCircle size={10} strokeWidth={2} className="schema-table-check" />
                      )}
                      {isSel && status === 'fetching' && (
                        <Loader size={10} strokeWidth={2} className="spin schema-table-check" />
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Column list after fetch */}
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
          {status === 'ready' ? `${rowCount?.toLocaleString() ?? '?'} rows · ${columns.length} cols`
            : status === 'browsing' ? 'Loading schema list…'
            : status === 'fetching' ? `Fetching ${selectedTable}…`
            : status === 'error' ? 'Failed — check connection'
            : !isConnected ? 'Connect a database node'
            : tables.length > 0 ? 'Pick a table to fetch'
            : 'Click Browse Schema'}
        </span>
        {status === 'error' && (
          <span style={{ marginLeft: 'auto' }}>
            <AlertCircle size={10} strokeWidth={2} style={{ color: 'var(--red)', verticalAlign: 'middle' }} />
          </span>
        )}
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(BrowseSchemaNode)

// ── Node definition & registration ───────────────────────────────────────────
export const browseSchemaNodeDef: NodeDef<BrowseSchemaNodeData> = {
  type: 'browse-schema',
  category: 'database',
  name: 'Browse Schema',
  desc: 'Browse and select tables from the connected database',
  Icon: LayoutGrid,
  help: {
    summary: 'Connects to PostgreSQL and shows all schemas and tables. Click any table to fetch its data into the pipeline.',
    inputs: 'Connection (violet square) — wire from a Connection node.',
    outputs: 'Row stream (blue square) and per-column handles (green circles) once a table is fetched.',
    tips: [
      'Click "Browse Schema" to load the full table list from the database.',
      'Type in the filter box to search across all schemas and table names.',
      'Click any table to immediately fetch it — no manual SQL needed.',
      'Click "Refresh Schema" to re-query the table list after schema changes.',
    ],
  },
  inputPorts:  [{ type: 'conn' }],
  outputPorts: [{ type: 'row' }],
  defaultData: () => ({
    tables: [], selectedSchema: null, selectedTable: null, filter: '',
    csvPath: null, columns: [], rowCount: null, status: 'idle', resolvedConfig: null,
  }),
  Component: Memoized,
}

registerNode(browseSchemaNodeDef)

export default Memoized
