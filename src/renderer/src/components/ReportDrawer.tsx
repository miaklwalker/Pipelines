import { useEffect, useRef, useCallback, useState } from 'react'
import { BarChart3, X, AlertTriangle, Loader, GripHorizontal } from 'lucide-react'
import type { ReportResult } from '../lib/types'

interface Props {
  nodeLabel: string
  result: ReportResult | null
  loading: boolean
  error: string | null
  onClose: () => void
}

const MIN_HEIGHT = 100
const MAX_HEIGHT = 700
const DEFAULT_HEIGHT = 320

function pct(nonNull: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((nonNull / total) * 100)
}

export default function ReportDrawer({ nodeLabel, result, loading, error, onClose }: Props) {
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [handleKey])

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
      <div className="preview-drawer-grip" onMouseDown={onResizeMouseDown} title="Drag to resize">
        <GripHorizontal size={13} strokeWidth={1.5} />
      </div>

      <div className="preview-header">
        <BarChart3 size={13} strokeWidth={1.75} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span className="preview-title">Report — {nodeLabel}</span>
        {result && (
          <span className="preview-badge">
            {result.rowCount.toLocaleString()} rows · {result.columns.length} columns
          </span>
        )}
        <button className="preview-close" onClick={onClose} title="Close (Esc)">
          <X size={13} strokeWidth={2} />
        </button>
      </div>

      <div className="preview-table-wrap">
        {loading && (
          <div className="preview-loading">
            <Loader size={16} strokeWidth={1.75} className="spin" style={{ marginBottom: 6, opacity: 0.5 }} />
            Profiling dataset…
          </div>
        )}

        {error && !loading && (
          <div className="preview-error">
            <AlertTriangle size={20} strokeWidth={1.5} style={{ marginBottom: 6, opacity: 0.7 }} />
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Profile failed</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
              {error}
            </div>
          </div>
        )}

        {!loading && !error && result && result.columns.length === 0 && (
          <div className="preview-empty">No columns to profile</div>
        )}

        {!loading && !error && result && result.columns.length > 0 && (
          <table className="preview-table report-table">
            <thead>
              <tr>
                <th>Column</th>
                <th>Type</th>
                <th>Filled</th>
                <th>Distinct</th>
                <th>Min</th>
                <th>Max</th>
                <th>Top values</th>
              </tr>
            </thead>
            <tbody>
              {result.columns.map((c) => {
                const p = pct(c.nonNull, result.rowCount)
                const nulls = result.rowCount - c.nonNull
                return (
                  <tr key={c.name}>
                    <td className="report-cell-name">{c.name}</td>
                    <td><span className="report-type">{c.type}</span></td>
                    <td>
                      <div className="report-fill-cell">
                        <span className="report-bar-track">
                          <span
                            className={`report-bar-fill${p < 100 ? ' partial' : ''}${p === 0 ? ' empty' : ''}`}
                            style={{ width: `${p}%` }}
                          />
                        </span>
                        <span className="report-fill-label">
                          {p}%
                          <span className="report-fill-sub">
                            {' '}({nulls.toLocaleString()} null{c.blank > 0 ? `, ${c.blank.toLocaleString()} blank` : ''})
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="report-num">{c.distinct.toLocaleString()}</td>
                    <td className="report-mono">{c.min === null ? <span className="preview-null">—</span> : c.min}</td>
                    <td className="report-mono">{c.max === null ? <span className="preview-null">—</span> : c.max}</td>
                    <td>
                      {c.top.length === 0
                        ? <span className="preview-null">—</span>
                        : (
                          <div className="report-top-list">
                            {c.top.map((t, i) => (
                              <span key={i} className="report-top-chip" title={`${t.count.toLocaleString()} rows`}>
                                <span className="report-top-val">{t.value === null ? 'NULL' : t.value === '' ? '(blank)' : t.value}</span>
                                <span className="report-top-count">{t.count.toLocaleString()}</span>
                              </span>
                            ))}
                          </div>
                        )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
