import { useState, useCallback } from 'react'
import { HelpCircle, SlidersHorizontal, X, Pencil } from 'lucide-react'
import { useReactFlow } from '@xyflow/react'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import type { NodeDef } from '../registry'

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
  const [helpOpen, setHelpOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const { Icon, name, help, hasAdvanced } = def
  const { getNode, setNodes } = useReactFlow()

  const meta = (getNode(id)?.data ?? {}) as NodeMeta
  const displayTitle = meta.nodeLabel || name

  const updateMeta = useCallback((patch: Partial<NodeMeta>) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)))
  }, [id, setNodes])

  const toggleHelp = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setHelpOpen((v) => !v)
    setEditOpen(false)
  }, [])

  const toggleEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setEditOpen((v) => !v)
    setHelpOpen(false)
  }, [])

  const handleGear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onAdvancedToggle?.()
  }, [onAdvancedToggle])

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
