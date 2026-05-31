import { memo, useCallback, useState } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { Database, Check, X, Plus, GripVertical } from 'lucide-react'
import type { AppNode, AppEdge, DestinationNodeData, ColMapping } from '../lib/types'
import { propagateColumns } from '../lib/graphUtils'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, colHandle } from './shared/handles'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: DestinationNodeData }>

function DestinationNode({ id, data, selected }: Props) {
  const { setNodes, getEdges } = useReactFlow()
  const { inputColumns = [], colMap = [] } = data
  const hasInput = inputColumns.length > 0

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

  // ── Derived ───────────────────────────────────────────────────────────────
  const includedCount = colMap.filter((m) => m.included !== false).length
  const subtitle = colMap.length > 0
    ? `${includedCount} / ${colMap.length} columns`
    : hasInput ? 'Add or filter columns' : 'No input connected'

  const hasAny = hasInput || colMap.some((m) => !m.sourceCol)

  return (
    <PipelineNode selected={selected}>
      {/* Row input */}
      <Handle type="target" position={Position.Left} id="row-in"
        style={rowHandle(hasInput, { top: '50%', left: -7 })}
      />
      {/* Row output */}
      <Handle type="source" position={Position.Right} id="row-out"
        style={rowHandle(true, { top: '50%', right: -7 })}
      />

      <NodeHeader def={destinationDef} subtitle={subtitle} />

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
  help: {
    summary: 'Maps the incoming row stream to a final output schema. Drag rows to reorder, rename or exclude upstream columns, or add computed columns via SQL expressions.',
    inputs: 'One row stream (left square). Emitter nodes (green circles) can override specific column values.',
    outputs: 'A remapped row stream (right square) and per-column handles for each included column.',
    tips: [
      'Drag the ⠿ grip to reorder any column — mix pass-through and custom columns freely.',
      'Edit the "Output name" field to rename a column in the result.',
      'Use ✓/✗ to include or exclude an upstream column.',
      'Click "+ Add Column" to create a computed column with any SQL expression.',
    ],
  },
  inputPorts: [{ type: 'row' }, { type: 'col' }],
  outputPorts: [{ type: 'row' }, { type: 'col' }],
  defaultData: () => ({ label: 'Output', inputColumns: [], colMap: [] }),
  Component: Memoized,
}

registerNode(destinationDef)

export default Memoized
