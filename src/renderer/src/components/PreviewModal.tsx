import { useEffect, useRef, useCallback } from 'react'
import { Eye, X, AlertTriangle, Loader } from 'lucide-react'
import type { PreviewResult } from '../lib/types'

interface Props {
  nodeLabel: string
  result: PreviewResult | null
  loading: boolean
  error: string | null
  onClose: () => void
}

export default function PreviewModal({ nodeLabel, result, loading, error, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [handleKey])

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose()
  }, [onClose])

  return (
    <div className="preview-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="preview-modal">
        <div className="preview-header">
          <Eye size={14} strokeWidth={1.75} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <span className="preview-title">Preview — {nodeLabel}</span>
          {result && (
            <span className="preview-badge">
              {result.rows.length} row{result.rows.length !== 1 ? 's' : ''} shown (max 50)
            </span>
          )}
          <button className="preview-close" onClick={onClose} title="Close (Esc)">
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        <div className="preview-table-wrap">
          {loading && (
            <div className="preview-loading">
              <Loader size={18} strokeWidth={1.75} className="spin" style={{ marginBottom: 8, opacity: 0.5 }} />
              Running query…
            </div>
          )}

          {error && !loading && (
            <div className="preview-error">
              <AlertTriangle size={24} strokeWidth={1.5} style={{ marginBottom: 8, opacity: 0.7 }} />
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Query failed</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
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
                        {cell === null ? <span className="preview-null">NULL</span> : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
