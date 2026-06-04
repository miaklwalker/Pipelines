import { useState, useCallback, useRef, useEffect } from 'react'
import { HelpCircle, SlidersHorizontal, X, Pencil, ChevronDown, ChevronRight, Palette } from 'lucide-react'
import { useReactFlow } from '@xyflow/react'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import type { NodeDef } from '../registry'
import { useNodeCollapse } from './PipelineNode'
import { useNodeColors } from '../../contexts/NodeColorContext'

// ── Preset colour palette ─────────────────────────────────────────────────────
const PRESET_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
]

interface NodeMeta {
  nodeLabel?: string
  nodeDescription?: string
}

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  def: NodeDef<any>
  id: string
  subtitle: string
  /** Whether the advanced panel is currently open (controlled by parent) */
  advancedOpen?: boolean
  /** Called when the gear icon is clicked */
  onAdvancedToggle?: () => void
}

export default function NodeHeader({ def, id, subtitle, advancedOpen, onAdvancedToggle }: Props) {
  const [helpOpen,        setHelpOpen]        = useState(false)
  const [editOpen,        setEditOpen]        = useState(false)
  const [colorPickerOpen, setColorPickerOpen] = useState(false)

  const { Icon, name, help, hasAdvanced } = def
  const { getNode, setNodes } = useReactFlow()

  const meta         = (getNode(id)?.data ?? {}) as NodeMeta
  const displayTitle = meta.nodeLabel || name

  // Collapse context — shared with ColumnList via PipelineNode
  const { collapsed, hasColumnList, toggle } = useNodeCollapse()

  // Color context — app-level
  const { userColors, setUserColor } = useNodeColors()
  const userColor = userColors[id] ?? null

  // Close picker when clicking outside
  const pickerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!colorPickerOpen) return
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setColorPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [colorPickerOpen])

  const updateMeta = useCallback((patch: Partial<NodeMeta>) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)))
  }, [id, setNodes])

  const toggleHelp = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setHelpOpen((v) => !v)
    setEditOpen(false)
    setColorPickerOpen(false)
  }, [])

  const toggleEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setEditOpen((v) => !v)
    setHelpOpen(false)
    setColorPickerOpen(false)
  }, [])

  const toggleColorPicker = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setColorPickerOpen((v) => !v)
    setHelpOpen(false)
    setEditOpen(false)
  }, [])

  const handleGear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onAdvancedToggle?.()
  }, [onAdvancedToggle])

  const handleCollapse = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    toggle()
  }, [toggle])

  const stopProp = useCallback((e: React.MouseEvent | React.PointerEvent) => e.stopPropagation(), [])

  return (
    <>
      <div className="node-header">
        <div className="node-header-icon-wrap">
          <Icon size={14} strokeWidth={1.75} />
        </div>
        <div className="node-header-info">
          <div className="node-header-title">{displayTitle}</div>
          <div className="node-header-sub">{subtitle}</div>
        </div>

        <div className="node-header-actions">
          {/* Collapse columns toggle — only shown when a ColumnList is present */}
          {hasColumnList && (
            <button
              className={`node-icon-btn${collapsed ? ' node-icon-btn-active' : ''}`}
              onClick={handleCollapse}
              title={collapsed ? 'Expand columns' : 'Collapse columns'}
            >
              {collapsed
                ? <ChevronRight size={11} strokeWidth={2} />
                : <ChevronDown  size={11} strokeWidth={2} />}
            </button>
          )}

          {/* Colour picker */}
          <button
            className={`node-icon-btn${(colorPickerOpen || userColor) ? ' node-icon-btn-active' : ''}`}
            onClick={toggleColorPicker}
            title="Color code this node"
            style={userColor ? { color: userColor } : undefined}
          >
            <Palette size={11} strokeWidth={1.75} />
          </button>

          {hasAdvanced && (
            <button
              className={`node-icon-btn${advancedOpen ? ' node-icon-btn-active' : ''}`}
              onClick={handleGear}
              title="Advanced settings"
            >
              <SlidersHorizontal size={11} strokeWidth={1.75} />
            </button>
          )}
          <button
            className={`node-icon-btn${editOpen ? ' node-icon-btn-active' : ''}`}
            onClick={toggleEdit}
            title="Edit label & description"
          >
            <Pencil size={11} strokeWidth={1.75} />
          </button>
          <button
            className={`node-icon-btn${helpOpen ? ' node-icon-btn-active' : ''}`}
            onClick={toggleHelp}
            title="About this node"
          >
            <HelpCircle size={11} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* ── Colour picker popover ────────────────────────────────────────── */}
      {colorPickerOpen && (
        <div
          ref={pickerRef}
          className="node-color-picker"
          onClick={stopProp}
          onMouseDown={stopProp}
          onPointerDown={stopProp}
        >
          {PRESET_COLORS.map((color) => (
            <button
              key={color}
              className={`color-swatch${userColor === color ? ' color-swatch-active' : ''}`}
              style={{ background: color }}
              onClick={(e) => {
                e.stopPropagation()
                // Toggle: clicking the active colour clears it
                setUserColor(id, userColor === color ? null : color)
                setColorPickerOpen(false)
              }}
              title={color}
            />
          ))}
          {userColor && (
            <button
              className="color-swatch color-swatch-clear"
              onClick={(e) => {
                e.stopPropagation()
                setUserColor(id, null)
                setColorPickerOpen(false)
              }}
              title="Clear color"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* ── Metadata panels ─────────────────────────────────────────────── */}
      {meta.nodeDescription && !editOpen && (
        <div className="node-meta-description">{meta.nodeDescription}</div>
      )}

      {editOpen && (
        <div className="node-meta-panel">
          <div className="node-meta-panel-header">
            <span className="help-dossier-title">Label & Notes</span>
            <button className="node-icon-btn" onClick={toggleEdit} title="Close">
              <X size={10} strokeWidth={2.5} />
            </button>
          </div>
          <div className="node-meta-row">
            <span className="node-meta-label">Label</span>
            <input
              className="node-input"
              placeholder={name}
              value={meta.nodeLabel ?? ''}
              onChange={(e) => updateMeta({ nodeLabel: e.target.value })}
              onClick={stopProp}
              onPointerDown={stopProp}
            />
          </div>
          <div className="node-meta-row">
            <span className="node-meta-label">Note</span>
            <textarea
              className="node-input node-meta-textarea"
              placeholder="Optional notes…"
              value={meta.nodeDescription ?? ''}
              onChange={(e) => updateMeta({ nodeDescription: e.target.value })}
              onClick={stopProp}
              onPointerDown={stopProp}
            />
          </div>
        </div>
      )}

      {helpOpen && (
        <div className="help-dossier">
          <div className="help-dossier-header">
            <span className="help-dossier-title">{name}</span>
            <button className="node-icon-btn" onClick={toggleHelp} title="Close">
              <X size={10} strokeWidth={2.5} />
            </button>
          </div>
          <p className="help-dossier-summary">{help.summary}</p>
          {help.inputs && (
            <div className="help-section">
              <div className="help-label">Inputs</div>
              <div className="help-text">{help.inputs}</div>
            </div>
          )}
          {help.outputs && (
            <div className="help-section">
              <div className="help-label">Outputs</div>
              <div className="help-text">{help.outputs}</div>
            </div>
          )}
          {help.tips && help.tips.length > 0 && (
            <div className="help-section">
              <div className="help-label">Tips</div>
              <ul className="help-tips">
                {help.tips.map((tip, i) => <li key={i}>{tip}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  )
}
