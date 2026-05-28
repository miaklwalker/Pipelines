import { memo, useState, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import type { AppNode, AppEdge, CSVOutputNodeData } from '../../lib/types'
import { buildNodeSQL } from '../../lib/sqlBuilder'

type Props = NodeProps<AppNode & { data: CSVOutputNodeData }>

type ExportStatus = 'idle' | 'running' | 'done' | 'error'

function CSVOutputNode({ id, data, selected }: Props) {
  const { getNodes, getEdges, setNodes } = useReactFlow()
  const { outputPath, includeHeader = true, inputColumns = [], lastExport } = data

  const [status, setStatus]   = useState<ExportStatus>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const hasInput = inputColumns.length > 0

  const update = useCallback(
    (patch: Partial<CSVOutputNodeData>) => {
      setNodes((ns) =>
        ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))
      )
    },
    [id, setNodes]
  )

  const handleExport = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      const nodes  = getNodes() as AppNode[]
      const edges  = getEdges() as AppEdge[]
      const sql    = buildNodeSQL(id, nodes, edges)

      if (!sql) {
        setErrorMsg('Connect a data source first')
        setStatus('error')
        return
      }

      setStatus('running')
      setErrorMsg('')

      try {
        const result = await window.api.exportCSV(sql)
        if (!result) { setStatus('idle'); return }

        update({
          outputPath: result.filePath,
          lastExport: { rowCount: result.rowCount, timestamp: new Date().toLocaleTimeString() }
        })
        setStatus('done')
        setTimeout(() => setStatus('idle'), 4000)
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err))
        setStatus('error')
      }
    },
    [id, getNodes, getEdges, update]
  )

  const toggleHeader = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    update({ includeHeader: !includeHeader })
  }, [includeHeader, update])

  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  return (
    <div className={`pipeline-node${selected ? ' selected' : ''}`} title="Click to preview">
      {/* Row input */}
      <Handle
        type="target"
        position={Position.Left}
        id="row-in"
        style={{
          top: '50%',
          left: -7,
          width: 13,
          height: 13,
          borderRadius: 3,
          background: hasInput ? 'var(--row-handle)' : '#334155',
          border: `2px solid ${hasInput ? 'var(--blue-dark)' : '#1e293b'}`,
        }}
      />

      <div className="node-header">
        <span className="node-header-icon">💾</span>
        <div className="node-header-info">
          <div className="node-header-title">CSV Export</div>
          <div className="node-header-sub">
            {outputPath
              ? outputPath.split('/').pop()
              : hasInput ? 'Ready to export' : 'No input connected'}
          </div>
        </div>
      </div>

      <div className="node-body">
        {/* Include header toggle */}
        <div className="node-body-row">
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11.5, color: 'var(--text-dim)' }}
            onClick={stopProp}
            onMouseDown={stopProp}
          >
            <input
              type="checkbox"
              checked={includeHeader}
              onChange={() => update({ includeHeader: !includeHeader })}
              style={{ cursor: 'pointer', accentColor: 'var(--blue)' }}
            />
            Include header row
          </label>
        </div>

        {/* Export button */}
        <button
          className="export-btn"
          onClick={handleExport}
          onMouseDown={stopProp}
          disabled={status === 'running' || !hasInput}
          style={{
            background: status === 'done'
              ? 'rgba(34,197,94,0.15)'
              : status === 'error'
                ? 'rgba(239,68,68,0.1)'
                : 'rgba(59,130,246,0.12)',
            borderColor: status === 'done'
              ? 'var(--green-dark)'
              : status === 'error'
                ? 'var(--red)'
                : 'var(--blue-dark)',
            color: status === 'done'
              ? 'var(--green)'
              : status === 'error'
                ? 'var(--red)'
                : 'var(--blue)',
          }}
        >
          {status === 'running' ? '⏳ Exporting…'
            : status === 'done'  ? '✓ Export complete'
            : status === 'error' ? '⚠ Export failed'
            : '↓ Export to CSV'}
        </button>

        {status === 'error' && errorMsg && (
          <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 4, wordBreak: 'break-all', fontFamily: 'var(--font-mono)' }}>
            {errorMsg}
          </div>
        )}

        {lastExport && status !== 'error' && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            Last: {lastExport.rowCount != null ? `${Number(lastExport.rowCount).toLocaleString()} rows` : 'complete'} at {lastExport.timestamp}
          </div>
        )}
      </div>

      <div className="status-row">
        <div className={`status-dot ${hasInput ? 'ready' : 'pending'}`} />
        <span className="status-text">
          {!hasInput ? 'Connect a data source' : `${inputColumns.length} columns in`}
        </span>
      </div>
    </div>
  )
}

export default memo(CSVOutputNode)
