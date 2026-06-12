import { memo, useCallback, useState } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { PenLine, Loader, CheckCircle, AlertCircle } from 'lucide-react'
import type { AppNode, UpdateDbRowNodeData } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, connHandle } from './shared/handles'
import SchemaTableBrowser from './shared/SchemaTableBrowser'
import { usePipelineActions } from '../contexts/PipelineActionsContext'

type Props = NodeProps<AppNode & { data: UpdateDbRowNodeData }>

function UpdateDbRowNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const { runSink } = usePipelineActions()
  const {
    tableName = '', pkColumn = '', updateColumns = [],
    status = 'idle', rowCount = null, error, resolvedConfig,
    inputColumns = [], targetColumns = [],
    dbTables = [], dbSelectedSchema = null, dbStatus = 'idle', dbError,
    updateProgress = null,
  } = data

  const [dbFilter, setDbFilter] = useState('')

  const update = useCallback(
    (patch: Partial<UpdateDbRowNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

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

  const handleSelectTable = useCallback(async (schema: string, table: string) => {
    update({ tableName: table, dbSelectedSchema: schema, dbStatus: 'loading', targetColumns: [], pkColumn: '', updateColumns: [], status: 'idle', error: undefined })
    try {
      const cols = await window.api.pgDescribeTable(resolvedConfig!, schema, table)
      update({ targetColumns: cols, dbStatus: 'idle' })
    } catch (err) {
      update({ dbStatus: 'error', dbError: (err as Error).message })
    }
  }, [resolvedConfig, update])

  const handleUpdate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    runSink(id)
  }, [id, runSink])

  const toggleUpdateColumn = useCallback((colName: string) => {
    const allNames = inputColumns.map((c) => c.name).filter((n) => n !== pkColumn)
    const effective = updateColumns.length > 0 ? updateColumns : allNames
    const next = effective.includes(colName)
      ? effective.filter((c) => c !== colName)
      : [...effective, colName]
    update({ updateColumns: next })
  }, [inputColumns, pkColumn, updateColumns, update])

  const isConnected = !!resolvedConfig
  const hasInput    = inputColumns.length > 0
  const isBrowsing  = dbStatus === 'browsing'
  const isLoading   = dbStatus === 'loading'
  const canUpdate   = isConnected && !!tableName && !!pkColumn && hasInput && status !== 'updating'

  const allCols = inputColumns.map((c) => c.name).filter((n) => n !== pkColumn)
  const effectiveUpdateCols = updateColumns.length > 0 ? updateColumns : allCols

  const selectedLabel = dbSelectedSchema ? `${dbSelectedSchema}.${tableName}` : tableName

  const updatingLabel = updateProgress
    ? `Updating ${updateProgress.written.toLocaleString()} / ${updateProgress.total.toLocaleString()} rows…`
    : 'Updating…'

  const subtitle = status === 'done'    ? `${rowCount?.toLocaleString()} rows updated`
    : status === 'updating'             ? updatingLabel
    : status === 'error'                ? 'Update failed'
    : isConnected ? (tableName ? `→ ${selectedLabel}` : 'Select a target table') : 'Connect a database'

  return (
    <PipelineNode selected={selected} title="Click to preview input data">
      <Handle type="target" position={Position.Left} id="conn-in"
        style={connHandle(isConnected, { top: 36, left: -7 })}
      />
      <Handle type="target" position={Position.Left} id="row-in"
        style={rowHandle(hasInput, { top: 64, left: -7 })}
      />

      <NodeHeader def={updateDbRowDef} id={id} subtitle={subtitle} />

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
        {/* Table selector */}
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

        <div className="node-body-row">
          <span className="node-label">Target</span>
          <div
            className="node-input"
            style={{ display: 'flex', alignItems: 'center', minHeight: 22, color: tableName ? 'var(--text)' : 'var(--text-muted)', fontStyle: tableName ? 'normal' : 'italic' }}
          >
            {isLoading
              ? <><Loader size={11} strokeWidth={2} className="spin" style={{ marginRight: 4 }} />Loading columns…</>
              : tableName ? selectedLabel : 'No table selected'}
          </div>
        </div>

        {dbError && <div className="db-error-msg">{dbError}</div>}

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

        {/* PK Column */}
        {tableName && (
          <div className="node-body-row" style={{ marginTop: 6 }}>
            <span className="node-label">PK</span>
            <select
              className="node-input"
              style={{ flex: 1 }}
              value={pkColumn}
              onChange={(e) => {
                const newPk = e.target.value
                update({
                  pkColumn: newPk,
                  updateColumns: updateColumns.filter((c) => c !== newPk),
                })
              }}
              onMouseDown={stopProp}
            >
              <option value="">— select primary key —</option>
              {inputColumns.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Update columns */}
        {tableName && pkColumn && inputColumns.length > 1 && (
          <div style={{ marginTop: 6 }}>
            <div className="node-label" style={{ marginBottom: 3 }}>Update columns</div>
            <div
              onMouseDown={stopProp}
              style={{ maxHeight: 100, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}
            >
              {allCols.map((col) => (
                <label
                  key={col}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', padding: '1px 0', fontSize: 11 }}
                >
                  <input
                    type="checkbox"
                    checked={effectiveUpdateCols.includes(col)}
                    onChange={() => toggleUpdateColumn(col)}
                    style={{ width: 11, height: 11, accentColor: 'var(--blue)' }}
                  />
                  <span style={{ color: 'var(--text)' }}>{col}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <button
          className={`db-fetch-btn${canUpdate ? '' : ' disabled'}`}
          onClick={handleUpdate}
          disabled={!canUpdate}
          style={{ marginTop: 6 }}
        >
          {status === 'updating'
            ? <><Loader size={11} strokeWidth={2} className="spin" />Updating…</>
            : status === 'done'
            ? <><CheckCircle size={11} strokeWidth={2} />Update Again</>
            : <>Update Rows</>}
        </button>

        {status === 'updating' && (
          <div style={{ marginTop: 5, height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
            {updateProgress && updateProgress.total > 0
              ? <div style={{
                  height: '100%', borderRadius: 2, background: 'var(--blue)',
                  width: `${Math.round((updateProgress.written / updateProgress.total) * 100)}%`,
                  transition: 'width 0.15s ease',
                }} />
              : <div style={{
                  height: '100%', width: '40%', borderRadius: 2, background: 'var(--blue)',
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
          {!isConnected       ? 'Connect a database node'
            : !hasInput       ? 'Connect a data source'
            : !tableName      ? 'Select a target table'
            : !pkColumn       ? 'Select a primary key column'
            : status === 'idle'     ? 'Ready to update'
            : status === 'updating' ? updatingLabel
            : status === 'done'     ? `Updated ${rowCount?.toLocaleString() ?? '?'} rows`
            : 'Update failed — check error above'}
        </span>
        {status === 'done'  && <CheckCircle size={10} strokeWidth={2} style={{ marginLeft: 'auto', color: 'var(--green)' }} />}
        {status === 'error' && <AlertCircle size={10} strokeWidth={2} style={{ marginLeft: 'auto', color: 'var(--red)' }} />}
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(UpdateDbRowNode)

export const updateDbRowDef: NodeDef<UpdateDbRowNodeData> = {
  type: 'update-db-row',
  category: 'database',
  name: 'Update DB Row',
  desc: 'UPDATE rows in Postgres matching a primary key',
  Icon: PenLine,
  help: {
    summary: 'Runs the upstream pipeline in DuckDB and issues a parameterized UPDATE for each output row, matching by a chosen primary key column.',
    inputs: 'Connection (violet square) + row stream (blue square).',
    outputs: 'None — this is a terminal node.',
    tips: [
      'Select the primary key column — this becomes the WHERE clause.',
      'Check only the columns you want to update; uncheck fields you want to leave unchanged.',
      'Rows with no matching PK in the target table are silently skipped by Postgres.',
      'All updates run inside a single transaction — they all succeed or all roll back.',
    ],
  },
  inputPorts:  [{ type: 'conn' }, { type: 'row' }],
  outputPorts: [],
  defaultData: () => ({
    tableName: '', pkColumn: '', updateColumns: [],
    status: 'idle', rowCount: null,
    inputColumns: [], targetColumns: [],
    dbTables: [], dbSelectedSchema: null, dbStatus: 'idle',
    resolvedConfig: null,
  }),
  Component: Memoized,
}

registerNode(updateDbRowDef)

export default Memoized
