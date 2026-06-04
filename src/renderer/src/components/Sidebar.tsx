import { SlidersHorizontal } from 'lucide-react'
import { getAllDefs, type NodeDef, type PortDef } from '../nodes'

// ── Port rail ─────────────────────────────────────────────────────────────────
// Collapses a node's ports into one indicator per kind (row / col / conn) so the
// card reads at a glance instead of showing a cluster of identical dots.
// A count is shown only for genuinely-multiple row/conn ports (e.g. Join's two
// row inputs); column handles are inherently per-column, so they never count.
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

// ── Palette card ──────────────────────────────────────────────────────────────
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

// ── Sidebar ───────────────────────────────────────────────────────────────────
interface Props { onAdd: (type: string) => void }

export default function Sidebar({ onAdd }: Props) {
  const defs = getAllDefs()
  const inputs   = defs.filter((d) => d.category === 'input')
  const ops      = defs.filter((d) => d.category === 'operation')
  const outputs  = defs.filter((d) => d.category === 'output')
  const emitters = defs.filter((d) => d.category === 'emitter')
  const database = defs.filter((d) => d.category === 'database')

  return (
    <aside className="sidebar">
      <div className="sidebar-section-title">Inputs</div>
      {inputs.map((def) => <PaletteCard key={def.type} def={def} onClick={() => onAdd(def.type)} />)}

      <div className="sidebar-section-title" style={{ marginTop: 10 }}>Operations</div>
      {ops.map((def) => <PaletteCard key={def.type} def={def} onClick={() => onAdd(def.type)} />)}

      <div className="sidebar-section-title" style={{ marginTop: 10 }}>Outputs</div>
      {outputs.map((def) => <PaletteCard key={def.type} def={def} onClick={() => onAdd(def.type)} />)}

      {emitters.length > 0 && (
        <>
          <div className="sidebar-section-title" style={{ marginTop: 10 }}>Emitters</div>
          {emitters.map((def) => <PaletteCard key={def.type} def={def} onClick={() => onAdd(def.type)} />)}
        </>
      )}

      {database.length > 0 && (
        <>
          <div className="sidebar-section-title sidebar-section-title-db" style={{ marginTop: 10 }}>Database</div>
          {database.map((def) => <PaletteCard key={def.type} def={def} onClick={() => onAdd(def.type)} />)}
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
