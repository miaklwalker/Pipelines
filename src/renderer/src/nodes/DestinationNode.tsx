import { memo, useCallback, useState } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { Database, Check, X, Plus, GripVertical } from 'lucide-react'
import type { AppNode, AppEdge, DestinationNodeData, ColMapping, TableEntry, ColumnInfo, PgConfig } from '../lib/types'
import { propagateColumns } from '../lib/graphUtils'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, colHandle, connHandle } from './shared/handles'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: DestinationNodeData }>

function DestinationNode({ id, data, selected }: Props) {
  const { setNodes, getEdges } = useReactFlow()
  const {
    inputColumns = [],
    colMap = [],
    resolvedConfig = null,
    dbTables = [],
    dbSelectedSchema = null,
    dbSelectedTable = null,
    dbTargetColumns = [],
    dbStatus = 'idle',
    dbError,
  } = data
  const hasInput = inputColumns.length > 0

  // Panel state
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [dbFilter, setDbFilter] = useState('')

  // Drag state
  const [dragIndex,     setDragIndex]     = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  // update: applies the patch then immediately re-propagates column info to
  // all downstream nodes, so they don't need an edge change to refresh.
  const update = useCallback(
    (patch: Partial<DestinationNodeData>) =>
      setNodes((ns) => {
        const updated = ns.map((n) => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)
        return propagateColumns(updated as AppNode[], getEdges() as AppEdge[])
      }),
    [id, setNodes, getEdges]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  // ── Column mutations (all index-based for simplicity) ─────────────────────
  const updateCol = useCallback((index: number, patch: Partial<ColMapping>) => {
    update({ colMap: colMap.map((m, i) => i === index ? { ...m, ...patch } : m) })
  }, [colMap, update])

  const removeCol = useCallback((index: number) => {
    update({ colMap: colMap.filter((_, i) => i !== index) })
  }, [colMap, update])

  const addCustomCol = useCallback(() => {
    update({ colMap: [...colMap, { sourceCol: '', destCol: '', included: true, customExpr: '' }] })
  }, [colMap, update])

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const onDragStart = useCallback((e: React.DragEvent, index: number) => {
    e.stopPropagation()
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    // Transparent ghost so the cursor is the only drag indicator
    const ghost = document.createElement('div')
    ghost.style.cssText = 'position:fixed;top:-999px'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 0, 0)
    setTimeout(() => document.body.removeChild(ghost), 0)
  }, [])

  const onDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }, [])

  const onDrop = useCallback((e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    e.stopPropagation()
    if (dragIndex !== null && dragIndex !== dropIndex) {
      const next = [...colMap]
      const [item] = next.splice(dragIndex, 1)
      next.splice(dropIndex, 0, item)
      update({ colMap: next })
    }
    setDragIndex(null)
    setDragOverIndex(null)
  }, [dragIndex, colMap, update])

  const onDragEnd = useCallback(() => {
    setDragIndex(null)
    setDragOverIndex(null)
  }, [])

  // ── DB schema browser handlers ─────────────────────────────────────────────
  const handleBrowse = useCallback(async () => {
    if (!resolvedConfig) return
    update({ dbStatus: 'browsing', dbError: undefined })
    try {
      const tables = await window.api.pgListTables(resolvedConfig as PgConfig)
      update({ dbTables: tables, dbStatus: 'browsing' })
    } catch (err) {
      update({ dbStatus: 'error', dbError: (err as Error).message })
    }
  }, [resolvedConfig, update])

  const handleSelectTable = useCallback(async (schema: string, table: string) => {
    if (!resolvedConfig) return
    update({ dbStatus: 'loading', dbSelectedSchema: schema, dbSelectedTable: table })
    try {
      const result: ColumnInfo[] = await window.api.pgDescribeTable(resolvedConfig as PgConfig, schema, table)
      // Align colMap: for each target column, match an upstream inputColumn or add custom entry
      const aligned: ColMapping[] = result.map((tc) => {
        const upstream = inputColumns.find((c) => c.name === tc.name)
        if (upstream) {
          // Existing pass-through match
          const existing = colMap.find((m) => m.sourceCol === tc.name)
          return existing
            ? existing
            : { sourceCol: tc.name, destCol: tc.name, included: true }
        }
        // Custom entry
        const existing = colMap.find((m) => !m.sourceCol && m.destCol === tc.name)
        return existing
          ? existing
          : { sourceCol: '', destCol: tc.name, included: true, customExpr: '' }
      })
      update({
        colMap: aligned,
        dbSelectedSchema: schema,
        dbSelectedTable: table,
        dbTargetColumns: result,
        dbStatus: 'ready',
      })
    } catch (err) {
      update({ dbStatus: 'error', dbError: (err as Error).message })
    }
  }, [resolvedConfig, inputColumns, colMap, update])

  // ── Derived ───────────────────────────────────────────────────────────────
  const includedCount = colMap.filter((m) => m.included !== false).length
  const subtitle = colMap.length > 0
    ? `${includedCount} / ${colMap.length} columns`
    : hasInput ? 'Add or filter columns' : 'No input connected'

  const hasAny = hasInput || colMap.some((m) => !m.sourceCol)

  const filteredTables = dbFilter.trim()
    ? (dbTables ?? []).filter((t) =>
        t.name.toLowerCase().includes(dbFilter.toLowerCase()) ||
        t.schema.toLowerCase().includes(dbFilter.toLowerCase())
      )
    : (dbTables ?? [])

  return (
    <PipelineNode selected={selected}>
      {/* Connection input (violet square) */}
      <Handle type="target" position={Position.Left} id="conn-in"
        style={connHandle(!!resolvedConfig, { top: 36, left: -7 })}
      />
      {/* Row input */}
      <Handle type="target" position={Position.Left} id="row-in"
        style={rowHandle(hasInput, { top: '50%', left: -7 })}
      />
      {/* Row output */}
      <Handle type="source" position={Position.Right} id="row-out"
        style={rowHandle(true, { top: '50%', right: -7 })}
      />

      <NodeHeader
        def={destinationDef}
        subtitle={subtitle}
        advancedOpen={advancedOpen}
        onAdvancedToggle={() => setAdvancedOpen((v) => !v)}
      />

      {/* ── Advanced: DB schema browser ─────────────────────────────────────── */}
      {advancedOpen && (
        /* Use join-col-panel (no bleed margins) instead of advanced-panel,
           which assumes it lives inside .node-body with 14px padding */
        <div
          className="dest-db-panel nodrag"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {!resolvedConfig ? (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Connect a Connection node (violet handle ↖) to browse a schema.
            </div>
          ) : (
            <>
              {/* Browse button row — button shrinks, label takes remaining space */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <button
                  className="dest-db-browse-btn"
                  onClick={(e) => { stopProp(e); handleBrowse() }}
                  onMouseDown={stopProp}
                  disabled={dbStatus === 'browsing' || dbStatus === 'loading'}
                >
                  {dbStatus === 'browsing' || dbStatus === 'loading' ? 'Loading…' : 'Browse Schema'}
                </button>
                {dbSelectedTable && (
                  <span style={{
                    fontSize: 10.5, color: 'var(--text-muted)',
                    flex: 1, minWidth: 0,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {dbSelectedSchema}.{dbSelectedTable}
                  </span>
                )}
              </div>

              {dbStatus === 'error' && (
                <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 6 }}>{dbError}</div>
              )}

              {(dbStatus === 'browsing' || dbStatus === 'ready') && (dbTables ?? []).length > 0 && (
                <>
                  <input
                    className="node-select"
                    style={{ width: '100%', marginBottom: 4, fontSize: 11 }}
                    placeholder="Filter tables…"
                    value={dbFilter}
                    onChange={(e) => setDbFilter(e.target.value)}
                    onClick={stopProp}
                    onMouseDown={stopProp}
                  />
                  <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: 11 }}>
                    {filteredTables.map((t) => {
                      const active = t.schema === dbSelectedSchema && t.name === dbSelectedTable
                      return (
                        <div
                          key={`${t.schema}.${t.name}`}
                          onClick={(e) => { stopProp(e); handleSelectTable(t.schema, t.name) }}
                          onMouseDown={stopProp}
                          style={{
                            padding: '3px 6px',
                            cursor: 'pointer',
                            borderRadius: 4,
                            background: active ? 'rgba(59,130,246,0.18)' : 'transparent',
                            color: active ? 'var(--blue)' : 'var(--text-dim)',
                          }}
                        >
                          <span style={{ color: 'var(--text-muted)' }}>{t.schema}.</span>{t.name}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {dbStatus === 'ready' && (dbTargetColumns ?? []).length > 0 && (
                <div style={{ marginTop: 6, borderTop: '1px solid var(--border)', paddingTop: 4 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Target columns
                  </div>
                  {(dbTargetColumns ?? []).map((c) => (
                    <div key={c.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '1px 0', color: 'var(--text-dim)' }}>
                      <span>{c.name}</span>
                      <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>{c.type}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Unified column list ─────────────────────────────────────────────── */}
      {colMap.length > 0 && (
        <div className="column-list">
          {/* Column header */}
          <div className="dest-list-header nodrag">
            <span style={{ width: 14, flexShrink: 0 }} />
            <span className="dest-list-hdr-label" style={{ flex: 1 }}>Source / Expression</span>
            <span className="dest-list-hdr-label" style={{ width: 80 }}>Output name</span>
            <span style={{ width: 20 }} />
          </div>

          {colMap.map((m, index) => {
            const isPass    = !!m.sourceCol
            const isExcluded = m.included === false
            const isDragging = dragIndex === index
            const isDragOver = dragOverIndex === index && dragIndex !== index

            const rowCls = [
              isPass ? 'dest-column-row' : 'dest-custom-row',
              'nodrag',          // tell React Flow: don't treat mousedown here as node drag
              isDragging ? 'dest-dragging' : '',
              isDragOver ? 'dest-drag-over' : '',
            ].filter(Boolean).join(' ')

            return (
              <div
                key={isPass ? m.sourceCol : `custom-${index}`}
                className={rowCls}
                style={isPass ? { opacity: isExcluded ? 0.4 : 1 } : undefined}
                draggable
                onDragStart={(e) => onDragStart(e, index)}
                onDragOver={(e) => onDragOver(e, index)}
                onDrop={(e) => onDrop(e, index)}
                onDragEnd={onDragEnd}
              >
                {/* Drag grip — mouseDown stops node-drag, not column interaction */}
                <GripVertical
                  size={11}
                  className="dest-grip"
                  onMouseDown={(e) => { e.stopPropagation() }}
                />

                {isPass ? (
                  // ── Pass-through column ─────────────────────────────────
                  <>
                    <Handle type="target" position={Position.Left} id={`col-in-${m.sourceCol}`}
                      style={colHandle({ width: 10, height: 10 })}
                    />
                    <span className="dest-src-name" style={{ textDecoration: isExcluded ? 'line-through' : 'none' }}>
                      {m.sourceCol}
                    </span>
                    <input
                      className="col-rename-input"
                      value={m.destCol}
                      title="Rename output column"
                      onChange={(e) => updateCol(index, { destCol: e.target.value })}
                      onClick={stopProp} onMouseDown={stopProp}
                      disabled={isExcluded}
                    />
                    <button
                      className={`col-toggle ${isExcluded ? 'col-toggle-off' : 'col-toggle-on'}`}
                      title={isExcluded ? 'Include' : 'Exclude'}
                      onClick={(e) => { stopProp(e); updateCol(index, { included: !m.included }) }}
                      onMouseDown={stopProp}
                    >
                      {isExcluded
                        ? <X size={10} strokeWidth={2.5} />
                        : <Check size={10} strokeWidth={2.5} />}
                    </button>
                    <Handle type="source" position={Position.Right} id={`col-out-${m.sourceCol}`}
                      style={colHandle({ width: 10, height: 10 })}
                    />
                  </>
                ) : (
                  // ── Custom column ───────────────────────────────────────
                  <>
                    {m.destCol && (
                      <Handle type="target" position={Position.Left} id={`col-in-custom-${m.destCol}`}
                        style={colHandle({ width: 10, height: 10 })}
                      />
                    )}
                    <input
                      className="dest-custom-input dest-custom-name"
                      value={m.destCol}
                      placeholder="col_name"
                      onChange={(e) => updateCol(index, { destCol: e.target.value })}
                      onClick={stopProp} onMouseDown={stopProp}
                    />
                    <span className="dest-custom-eq">=</span>
                    <input
                      className="dest-custom-input dest-custom-expr"
                      value={m.customExpr ?? ''}
                      placeholder="expression"
                      title="SQL expression. Wiring an emitter node overrides this."
                      onChange={(e) => updateCol(index, { customExpr: e.target.value })}
                      onClick={stopProp} onMouseDown={stopProp}
                    />
                    <button
                      className="dest-custom-remove"
                      title="Remove column"
                      onClick={(e) => { stopProp(e); removeCol(index) }}
                      onMouseDown={stopProp}
                    >
                      <X size={9} strokeWidth={2.5} />
                    </button>
                    {m.destCol && (
                      <Handle type="source" position={Position.Right} id={`col-out-${m.destCol}`}
                        style={colHandle({ width: 10, height: 10 })}
                      />
                    )}
                  </>
                )}
              </div>
            )
          })}
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

      {!hasAny && (
        <div style={{ padding: '0 14px 8px', color: 'var(--text-muted)', fontSize: 11 }}>
          Connect a row input or add custom columns.
        </div>
      )}

      <div className="status-row">
        <div className={`status-dot ${hasAny ? 'ready' : 'pending'}`} />
        <span className="status-text">
          {hasAny ? 'Ready — click to preview' : 'Awaiting input'}
        </span>
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(DestinationNode)

// ── Node definition & registration ───────────────────────────────────────────
export const destinationDef: NodeDef<DestinationNodeData> = {
  type: 'destination',
  category: 'output',
  name: 'Destination',
  desc: 'Shape output columns: rename, filter, reorder, or add new ones',
  Icon: Database,
  hasAdvanced: true,
  help: {
    summary: 'Maps the incoming row stream to a final output schema. Drag rows to reorder, rename or exclude upstream columns, or add computed columns via SQL expressions.',
    inputs: 'One row stream (left square). Emitter nodes (green circles) can override specific column values. A Connection node (violet square) unlocks the schema browser.',
    outputs: 'A remapped row stream (right square) and per-column handles for each included column.',
    tips: [
      'Drag the grip to reorder any column — mix pass-through and custom columns freely.',
      'Edit the "Output name" field to rename a column in the result.',
      'Use ✓/✗ to include or exclude an upstream column.',
      'Click "+ Add Column" to create a computed column with any SQL expression.',
      'Connect a Connection node and use the Advanced panel to align columns to a target DB table.',
    ],
  },
  inputPorts: [{ type: 'row' }, { type: 'col' }, { type: 'conn' }],
  outputPorts: [{ type: 'row' }, { type: 'col' }],
  defaultData: () => ({
    label: 'Output',
    inputColumns: [],
    colMap: [],
    resolvedConfig: null,
    dbTables: [],
    dbSelectedSchema: null,
    dbSelectedTable: null,
    dbTargetColumns: [],
    dbStatus: 'idle' as const,
    dbError: undefined,
  }),
  Component: Memoized,
}

registerNode(destinationDef)

export default Memoized
