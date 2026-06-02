import { memo, useCallback, useEffect, useState } from 'react'
import { Handle, Position, useReactFlow, useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import { Database, X, Plus, GripVertical } from 'lucide-react'
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
  const updateNodeInternals = useUpdateNodeInternals()
  const {
    colMap = [],
    resolvedConfig = null,
    dbTables = [],
    dbSelectedSchema = null,
    dbSelectedTable = null,
    dbTargetColumns = [],
    dbStatus = 'idle',
    dbError,
  } = data

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

  // Re-register handles with React Flow whenever columns change (adds/removes/renames)
  // so edge lines draw correctly to dynamic col-in-custom-* handles.
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, updateNodeInternals, colMap.length, colMap.map(m => m.destCol).join(',')])

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
      // Align colMap to target schema: preserve existing custom entries, add missing ones
      const aligned: ColMapping[] = result.map((tc) => {
        const existing = colMap.find((m) => m.destCol === tc.name)
        return existing ?? { sourceCol: '', destCol: tc.name, included: true, customExpr: '' }
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
  }, [resolvedConfig, colMap, update])

  // ── Derived ───────────────────────────────────────────────────────────────
  const includedCount = colMap.filter((m) => m.included !== false).length
  const subtitle = colMap.length > 0
    ? `${includedCount} / ${colMap.length} columns`
    : 'No columns yet'

  const hasAny = colMap.length > 0

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
      {/* Row output — passes destination result downstream */}
      <Handle type="source" position={Position.Right} id="row-out"
        style={rowHandle(hasAny, { top: '50%', right: -7 })}
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
            <span className="dest-list-hdr-label" style={{ width: 80 }}>Column name</span>
            <span className="dest-list-hdr-label" style={{ flex: 1, textAlign: 'center' }}>Expression</span>
            <span style={{ width: 20 }} />
          </div>

          {colMap.map((m, index) => {
            const isDragging = dragIndex === index
            const isDragOver = dragOverIndex === index && dragIndex !== index

            const rowCls = [
              'dest-custom-row',
              'nodrag',
              isDragging ? 'dest-dragging' : '',
              isDragOver ? 'dest-drag-over' : '',
            ].filter(Boolean).join(' ')

            return (
              <div
                key={`custom-${index}`}
                className={rowCls}
                draggable
                onDragStart={(e) => onDragStart(e, index)}
                onDragOver={(e) => onDragOver(e, index)}
                onDrop={(e) => onDrop(e, index)}
                onDragEnd={onDragEnd}
              >
                {/* Drag grip */}
                <GripVertical
                  size={11}
                  className="dest-grip"
                  onMouseDown={(e) => { e.stopPropagation() }}
                />

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
          Add columns and wire emitter nodes to define the output.
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
  desc: 'Define output columns and wire emitter nodes to populate them',
  //@ts-ignore
  Icon: Database,
  hasAdvanced: true,
  help: {
    summary: 'Defines the final output schema. Each column gets its value from a wired emitter node or a typed SQL expression. Row count comes from the shared anchor on the emitter nodes.',
    inputs: 'Emitter nodes (green circles) wired to each column\'s input handle. A Connection node (violet square) unlocks the schema browser.',
    outputs: 'Per-column handles for each defined column.',
    tips: [
      'Click "+ Add Column", name it, then wire an emitter to its green input handle.',
      'Type a SQL expression directly in the "expression" field as an alternative to wiring.',
      'Drag the grip to reorder columns.',
      'Connect a Connection node and use the Advanced panel to align columns to a target DB table.',
    ],
  },
  inputPorts: [{ type: 'col' }, { type: 'conn' }],
  outputPorts: [{ type: 'row' }, { type: 'col' }],
  defaultData: () => ({
    label: 'Output',
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
