import { useState, useCallback } from 'react'
import { HelpCircle, SlidersHorizontal, X } from 'lucide-react'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import type { NodeDef } from '../registry'

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  def: NodeDef<any>
  subtitle: string
  /** Whether the advanced panel is currently open (controlled by parent) */
  advancedOpen?: boolean
  /** Called when the gear icon is clicked */
  onAdvancedToggle?: () => void
}

export default function NodeHeader({ def, subtitle, advancedOpen, onAdvancedToggle }: Props) {
  const [helpOpen, setHelpOpen] = useState(false)
  const { Icon, name, help, hasAdvanced } = def

  const toggleHelp = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setHelpOpen((v) => !v)
  }, [])

  const handleGear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onAdvancedToggle?.()
  }, [onAdvancedToggle])

  return (
    <>
      <div className="node-header">
        <div className="node-header-icon-wrap">
          <Icon size={14} strokeWidth={1.75} />
        </div>
        <div className="node-header-info">
          <div className="node-header-title">{name}</div>
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
            className={`node-icon-btn${helpOpen ? ' node-icon-btn-active' : ''}`}
            onClick={toggleHelp}
            title="About this node"
          >
            <HelpCircle size={11} strokeWidth={1.75} />
          </button>
        </div>
      </div>

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
