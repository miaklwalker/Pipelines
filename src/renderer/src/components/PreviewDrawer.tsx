import { useEffect, useRef, useCallback, useState } from 'react'
import { Eye, X, AlertTriangle, Loader, GripHorizontal } from 'lucide-react'
import type { PreviewResult } from '../lib/types'

interface Props {
  nodeLabel: string
  result: PreviewResult | null
  loading: boolean
  error: string | null
  onClose: () => void
}

const MIN_HEIGHT = 100
const MAX_HEIGHT = 700
const DEFAULT_HEIGHT = 280

export default function PreviewDrawer({ nodeLabel, result, loading, error, onClose }: Props) {
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)

  // Escape key closes drawer
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [handleKey])

  // Resize drag on the grip bar
  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startY: e.clientY, startH: height }

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const delta = dragRef.current.startY - ev.clientY
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, dragRef.current.startH + delta)))
    }
    const onUp = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [height])

  return (
    <div className="preview-drawer" style={{ height }}>
      {/* Drag-to-resize handle */}
      <div className="preview-drawer-grip" onMouseDown={onResizeMouseDown} title="Drag to resize">
        <GripHorizontal size={13} strokeWidth={1.5} />
      </div>

      {/* Header */}
      <div className="preview-header">
        <Eye size={13} strokeWidth={1.75} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span className="preview-title">Preview — {nodeLabel}</span>
        {result && (
          <span className="preview-badge">
            {result.rows.length} row{result.rows.length !== 1 ? 's' : ''} shown
            {typeof result.rowCount === 'number' ? ` of ${result.rowCount}` : ''} (max 50)
          </span>
        )}
        <button className="preview-close" onClick={onClose} title="Close (Esc)">
          <X size={13} strokeWidth={2} />
        </button>
      </div>

      {/* Table / states */}
      <div className="preview-table-wrap">
        {loading && (
          <div className="preview-loading">
            <Loader size={16} strokeWidth={1.75} className="spin" style={{ marginBottom: 6, opacity: 0.5 }} />
            Running query…
          </div>
        )}

        {error && !loading && (
          <div className="preview-error">
            <AlertTriangle size={20} strokeWidth={1.5} style={{ marginBottom: 6, opacity: 0.7 }} />
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Query failed</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
              {error}
            </div>
          </div>
        )}

        {!loading && !error && result && result.rows.length === 0 && (
          <div className="preview-empty">No rows returned</div>
        )}

        {!loading && !error && result && result.rows.length > 0 && (
          <table className="preview-table">
            <thead>
              <tr>
                <th style={{ color: 'var(--text-muted)', userSelect: 'none' }}>#</th>
                {result.columns.map((col) => <th key={col}>{col}</th>)}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, ri) => (
                <tr key={ri}>
                  <td style={{ color: 'var(--text-muted)', userSelect: 'none', minWidth: 36 }}>{ri + 1}</td>
                  {row.map((cell, ci) => (
                    <td key={ci}>
                      {cell === null ? <span className="preview-null">NULL</span> : String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
