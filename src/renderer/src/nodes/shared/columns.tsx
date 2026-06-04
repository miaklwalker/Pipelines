import { type ColumnInfo } from '../../lib/types'
import { Handle, Position } from '@xyflow/react'
import { colHandle } from './handles'
import { useCallback, useEffect } from 'react'
import { useNodeCollapse } from './PipelineNode'

export function typeBadgeClass(type: string): string {
    const t = type.toLowerCase()
    if (t === 'integer') return 'type-integer'
    if (t === 'float') return 'type-float'
    if (t === 'text') return 'type-text'
    if (t === 'boolean') return 'type-boolean'
    if (t === 'date') return 'type-date'
    if (t === 'timestamp') return 'type-timestamp'
    return 'type-default'
}

// ── Standard column list (one col-out handle per row) ─────────────────────────
export function ColumnList({ columns }: { columns: Array<ColumnInfo> }) {
    const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])
    const { collapsed, register, unregister } = useNodeCollapse()

    const hasColumns = columns.length > 0
    useEffect(() => {
        if (hasColumns) {
            register()
            return unregister
        }
        return undefined
    }, [hasColumns, register, unregister])

    if (collapsed) return null

    return (
        <div className="column-list nowheel nodrag">
            {columns.map((col) => (
                <div key={col.name} className="column-row">
                    <span className="col-name" title={col.name}>{col.name}</span>
                    <span className={`col-type-badge ${typeBadgeClass(col.type)}`}>{col.type}</span>
                    <Handle
                        type="source"
                        position={Position.Right}
                        id={`col-out-${col.name}`}
                        onMouseDown={stopProp}
                        style={colHandle({ width: 11, height: 11 })}
                    />
                </div>
            ))}
        </div>
    )
}

// ── Filter column list (pass + fail col handles per row) ──────────────────────
// Each row is 44 px tall so the two handles can be stacked vertically:
//   pass (green circle) at 30% ≈ top 13 px
//   fail (red   circle) at 70% ≈ top 31 px
// The P/F header is included here so it collapses together with the rows.
export function FilterColumnList({ columns }: { columns: Array<ColumnInfo> }) {
    const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])
    const { collapsed, register, unregister } = useNodeCollapse()

    const hasColumns = columns.length > 0
    useEffect(() => {
        if (hasColumns) {
            register()
            return unregister
        }
        return undefined
    }, [hasColumns, register, unregister])

    if (collapsed) return null

    return (
        <div className="column-list nowheel nodrag">
            {/* P / F column header */}
            <div className="filter-col-list-hdr">
                <span className="filter-col-list-hdr-name">Column</span>
                <span className="filter-col-list-hdr-pass">P</span>
                <span className="filter-col-list-hdr-fail">F</span>
            </div>

            {columns.map((col) => (
                <div key={col.name} className="filter-column-row">
                    <span className="col-name" title={col.name}>{col.name}</span>

                    {/* Pass — upper handle */}
                    <Handle
                        type="source"
                        position={Position.Right}
                        id={`col-out-pass-${col.name}`}
                        onMouseDown={stopProp}
                        style={colHandle({ top: '30%' })}
                    />

                    {/* Fail — lower handle */}
                    <Handle
                        type="source"
                        position={Position.Right}
                        id={`col-out-fail-${col.name}`}
                        onMouseDown={stopProp}
                        style={{
                            top: '70%',
                            width: 9, height: 9, borderRadius: '50%',
                            background: 'var(--red)', border: '2px solid rgba(239,68,68,0.6)',
                        }}
                    />
                </div>
            ))}
        </div>
    )
}
