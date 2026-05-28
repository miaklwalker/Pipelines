import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { AppNode, CSVNodeData } from '../../lib/types'

function typeBadgeClass(type: string): string {
  const t = type.toLowerCase()
  if (t === 'integer')   return 'type-integer'
  if (t === 'float')     return 'type-float'
  if (t === 'text')      return 'type-text'
  if (t === 'boolean')   return 'type-boolean'
  if (t === 'date')      return 'type-date'
  if (t === 'timestamp') return 'type-timestamp'
  return 'type-default'
}

type Props = NodeProps<AppNode & { data: CSVNodeData }>

function CSVInputNode({ data, selected }: Props) {
  const { fileName, columns } = data

  const stopPropagation = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  return (
    <div
      className={`pipeline-node${selected ? ' selected' : ''}`}
      title="Click to preview"
    >
      {/*
        Row-stream output — square at the TOP-RIGHT corner of the node.
        position=Right so edges route rightward. We override top/right to pin it
        to the corner; transform: translate(50%, -50%) makes it straddle the corner.
      */}
      <Handle
        type="source"
        position={Position.Right}
        id="row-out"
        style={{
          top: 0,
          right: 0,
          left: 'auto',
          bottom: 'auto',
          transform: 'translate(50%, -50%)',
          width: 13,
          height: 13,
          borderRadius: 3,
          background: 'var(--row-handle)',
          border: '2px solid var(--blue-dark)',
        }}
      />

      {/* Header */}
      <div className="node-header">
        <span className="node-header-icon">📄</span>
        <div className="node-header-info">
          <div className="node-header-title">{fileName || 'CSV File'}</div>
          <div className="node-header-sub">
            {columns.length} column{columns.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Column rows — each handle lives INSIDE its row div (position: relative).
          React Flow's default top: 50% then resolves to 50% of the ROW's height,
          perfectly centering each circle regardless of font metrics. */}
      <div className="column-list">
        {columns.map((col) => (
          <div key={col.name} className="column-row">
            <span className="col-name" title={col.name}>{col.name}</span>
            <span className={`col-type-badge ${typeBadgeClass(col.type)}`}>{col.type}</span>

            <Handle
              type="source"
              position={Position.Right}
              id={`col-out-${col.name}`}
              onMouseDown={stopPropagation}
              style={{
                width: 11,
                height: 11,
                borderRadius: '50%',
                background: 'var(--green)',
                border: '2px solid var(--green-dark)',
              }}
            />
          </div>
        ))}
      </div>

      {columns.length === 0 && (
        <div style={{ padding: '12px 14px', color: 'var(--text-muted)', fontSize: 11 }}>
          No columns detected
        </div>
      )}
    </div>
  )
}

export default memo(CSVInputNode)
