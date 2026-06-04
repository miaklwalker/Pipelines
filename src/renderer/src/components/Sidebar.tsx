import { useCallback, useEffect, useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { getAllDefs, type NodeDef, type PortDef } from '../nodes'

// ── Port rail (full single-column cards) ──────────────────────────────────────
const PORT_ORDER: PortDef['type'][] = ['row', 'col', 'conn']
const PORT_LABEL: Record<PortDef['type'], string> = { row: 'Row stream', col: 'Column', conn: 'DB connection' }

function PortRail({ ports, side }: { ports: PortDef[]; side: 'in' | 'out' }) {
  const counts = new Map<PortDef['type'], number>()
  for (const p of ports) counts.set(p.type, (counts.get(p.type) ?? 0) + 1)
  const kinds = PORT_ORDER.filter((k) => counts.has(k))

  if (!kinds.length) {
    return (
      <div className="palette-ports">
        <span className="palette-rail-dash" title={side === 'in' ? 'No inputs' : 'No outputs'}>–</span>
      </div>
    )
  }

  return (
    <div className="palette-ports">
      {kinds.map((k) => {
        const n = counts.get(k)!
        const showCount = n > 1 && k !== 'col'
        const cls = k === 'conn' ? 'palette-port-conn' : k === 'row' ? 'palette-port-row' : 'palette-port-col'
        const noun = side === 'in' ? 'input' : 'output'
        const title = k === 'col'
          ? `Per-column ${noun}s`
          : `${PORT_LABEL[k]} ${noun}${showCount ? `s ×${n}` : ''}`
        return (
          <span className="palette-port-wrap" key={k} title={title}>
            <span className={`palette-port ${cls}`} />
            {showCount && <span className="palette-port-count">{n}</span>}
          </span>
        )
      })}
    </div>
  )
}

// ── Full palette card (1-column layout) ───────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PaletteCard({ def, onClick }: { def: NodeDef<any>; onClick: () => void }) {
  const { Icon, name, desc, inputPorts, outputPorts, hasAdvanced } = def
  return (
    <button className="palette-card" onClick={onClick} title={desc}>
      <PortRail ports={inputPorts} side="in" />

      <div className="palette-body">
        <div className="palette-icon-wrap">
          <Icon size={13} strokeWidth={1.75} />
        </div>
        <div className="palette-info">
          <div className="palette-name">
            {name}
            {hasAdvanced && (
              <SlidersHorizontal size={9} strokeWidth={2} style={{ display: 'inline', marginLeft: 4, verticalAlign: 'middle', opacity: 0.5 }} />
            )}
          </div>
          <div className="palette-desc">{desc}</div>
        </div>
      </div>

      <PortRail ports={outputPorts} side="out" />
    </button>
  )
}

// ── Port dots (compact card port indicators) ──────────────────────────────────
function PortDots({ ports }: { ports: PortDef[] }) {
  const kinds = PORT_ORDER.filter((k) => ports.some((p) => p.type === k))
  if (!kinds.length) return <span style={{ fontSize: 8, color: 'var(--text-muted)', lineHeight: 1 }}>–</span>
  return (
    <>
      {kinds.map((k) => {
        const cls = k === 'conn' ? 'palette-port-conn' : k === 'row' ? 'palette-port-row' : 'palette-port-col'
        return <span key={k} className={`palette-port ${cls}`} style={{ width: 7, height: 7 }} />
      })}
    </>
  )
}

// ── Compact palette card (2-3 column grid layout) ─────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PaletteCardCompact({ def, onClick }: { def: NodeDef<any>; onClick: () => void }) {
  const { Icon, name, desc, inputPorts, outputPorts } = def
  return (
    <button
      className="palette-card palette-card-compact"
      onClick={onClick}
      title={`${name} — ${desc}`}
    >
      <div className="palette-compact-icon">
        <Icon size={15} strokeWidth={1.75} />
      </div>
      <div className="palette-compact-name">{name}</div>
      <div className="palette-compact-desc">{desc}</div>
      <div className="palette-compact-ports">
        <div className="palette-compact-port-group"><PortDots ports={inputPorts} /></div>
        <div className="palette-compact-port-group"><PortDots ports={outputPorts} /></div>
      </div>
    </button>
  )
}

// ── Section: renders full cards or a compact grid depending on col count ───────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SectionCards({ defs, cols, onAdd }: { defs: NodeDef<any>[]; cols: number; onAdd: (type: string) => void }) {
  if (cols === 1) {
    return <>{defs.map((def) => <PaletteCard key={def.type} def={def} onClick={() => onAdd(def.type)} />)}</>
  }
  return (
    <div className="palette-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {defs.map((def) => <PaletteCardCompact key={def.type} def={def} onClick={() => onAdd(def.type)} />)}
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
const MIN_W = 180
const MAX_W = 560
const DEFAULT_W = 210

interface Props { onAdd: (type: string) => void }

export default function Sidebar({ onAdd }: Props) {
  const [width, setWidth] = useState(DEFAULT_W)
  const dragging  = useRef(false)
  const startX    = useRef(0)
  const startW    = useRef(0)
  const widthRef  = useRef(width)
  widthRef.current = width

  const onDragStart = useCallback((e: React.MouseEvent) => {
    dragging.current = true
    startX.current   = e.clientX
    startW.current   = widthRef.current
    document.body.style.cursor     = 'col-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const next = Math.max(MIN_W, Math.min(MAX_W, startW.current + (e.clientX - startX.current)))
      setWidth(next)
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current               = false
      document.body.style.cursor     = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, [])

  // 1 col below 280 px, 2 cols up to 420 px, 3 cols above that
  const cols = width >= 420 ? 3 : width >= 280 ? 2 : 1

  const defs     = getAllDefs()
  const inputs   = defs.filter((d) => d.category === 'input')
  const ops      = defs.filter((d) => d.category === 'operation')
  const outputs  = defs.filter((d) => d.category === 'output')
  const emitters = defs.filter((d) => d.category === 'emitter')
  const database = defs.filter((d) => d.category === 'database')

  return (
    <aside className="sidebar" style={{ width }}>
      {/* Drag handle — sits on the right edge */}
      <div className="sidebar-resize-handle" onMouseDown={onDragStart} />

      <div className="sidebar-section-title">Inputs</div>
      <SectionCards defs={inputs} cols={cols} onAdd={onAdd} />

      <div className="sidebar-section-title" style={{ marginTop: 10 }}>Operations</div>
      <SectionCards defs={ops} cols={cols} onAdd={onAdd} />

      <div className="sidebar-section-title" style={{ marginTop: 10 }}>Outputs</div>
      <SectionCards defs={outputs} cols={cols} onAdd={onAdd} />

      {emitters.length > 0 && (
        <>
          <div className="sidebar-section-title" style={{ marginTop: 10 }}>Emitters</div>
          <SectionCards defs={emitters} cols={cols} onAdd={onAdd} />
        </>
      )}

      {database.length > 0 && (
        <>
          <div className="sidebar-section-title sidebar-section-title-db" style={{ marginTop: 10 }}>Database</div>
          <SectionCards defs={database} cols={cols} onAdd={onAdd} />
        </>
      )}

      <div style={{ flex: 1 }} />
      <div className="sidebar-divider" />

      {/* Legend */}
      <div style={{ padding: '8px 12px 10px' }}>
        <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Legend</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--blue)', border: '1px solid var(--blue-dark)', flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Row stream (table)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', border: '1px solid var(--green-dark)', flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Column (individual)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: '#7c3aed', border: '1px solid #5b21b6', flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Database connection</span>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Click any node to preview.{' '}
          <SlidersHorizontal size={9} strokeWidth={2} style={{ display: 'inline', verticalAlign: 'middle', opacity: 0.5 }} />
          {' '}= has advanced options.
        </div>
      </div>
    </aside>
  )
}
