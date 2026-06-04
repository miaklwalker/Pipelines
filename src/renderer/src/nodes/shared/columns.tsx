import { type ColumnInfo } from '../../lib/types'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { colHandle } from './handles'
import { useCallback } from 'react'
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

export function ColumnList({ columns }: { columns: Array<ColumnInfo> }) {
    const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])
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