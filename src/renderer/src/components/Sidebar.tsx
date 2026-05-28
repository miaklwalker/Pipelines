import { SlidersHorizontal } from 'lucide-react'
import { getAllDefs, type NodeDef, type PortDef } from '../nodes'

// ── Port dot ──────────────────────────────────────────────────────────────────
function Port({ type }: { type: PortDef['type'] }) {
  return (
    <div className={`palette-port ${type === 'row' ? 'palette-port-row' : 'palette-port-col'}`} />
  )
}

// ── Palette card ──────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PaletteCard({ def, onClick }: { def: NodeDef<any>; onClick: () => void }) {
  const { Icon, name, desc, inputPorts, outputPorts, hasAdvanced } = def
  return (
    <button className="palette-card" onClick={onClick} title={desc}>
      {/* Input ports */}
      <div className="palette-ports">
        {inputPorts.map((p, i) => <Port key={i} type={p.type} />)}
        {inputPorts.length === 0 && <div style={{ width: 7 }} />}
      </div>

      {/* Icon + label */}
      <div className="palette-body">
        <div className="palette-icon-wrap">
          <Icon size={13} strokeWidth={1.75} />
        </div>
        <div className="palette-info">
          <div className="palette-name">
            {name}
            {hasAdvanced && (
              <SlidersHorizontal
                size={9}
                strokeWidth={2}
                style={{ display: 'inline', marginLeft: 4, verticalAlign: 'middle', opacity: 0.5 }}
              />
            )}
          </div>
          <div className="palette-desc">{desc}</div>
        </div>
      </div>

      {/* Output ports */}
      <div className="palette-ports">
        {outputPorts.map((p, i) => <Port key={i} type={p.type} />)}
        {outputPorts.length === 0 && <div style={{ width: 7 }} />}
      </div>
    </button>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
interface Props {
  onAdd: (type: string) => void
}

export default function Sidebar({ onAdd }: Props) {
  const defs = getAllDefs()
  const inputs     = defs.filter((d) => d.category === 'input')
  const operations = defs.filter((d) => d.category === 'operation')
  const outputs    = defs.filter((d) => d.category === 'output')
  const emitters   = defs.filter((d) => d.category === 'emitter')

  return (
    <aside className="sidebar">
      <div className="sidebar-section-title">Inputs</div>
      {inputs.map((def) => (
        <PaletteCard key={def.type} def={def} onClick={() => onAdd(def.type)} />
      ))}

      <div className="sidebar-section-title" style={{ marginTop: 10 }}>Operations</div>
      {operations.map((def) => (
        <PaletteCard key={def.type} def={def} onClick={() => onAdd(def.type)} />
      ))}

      <div className="sidebar-section-title" style={{ marginTop: 10 }}>Outputs</div>
      {outputs.map((def) => (
        <PaletteCard key={def.type} def={def} onClick={() => onAdd(def.type)} />
      ))}

      {emitters.length > 0 && (
        <>
          <div className="sidebar-section-title" style={{ marginTop: 10 }}>Emitters</div>
          {emitters.map((def) => (
            <PaletteCard key={def.type} def={def} onClick={() => onAdd(def.type)} />
          ))}
        </>
      )}

      <div style={{ flex: 1 }} />
      <div className="sidebar-divider" />

      {/* Legend */}
      <div style={{ padding: '8px 12px 10px' }}>
        <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
          Legend
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--blue)', border: '1px solid var(--blue-dark)', flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Row stream (table)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', border: '1px solid var(--green-dark)', flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Column (individual)</span>
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
