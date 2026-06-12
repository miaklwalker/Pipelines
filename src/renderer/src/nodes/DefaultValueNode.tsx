import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { Replace } from 'lucide-react'
import type { AppNode, DefaultValueData } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, colHandle, HEADER_ROW_IN, HEADER_ROW_OUT } from './shared/handles'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: DefaultValueData }>

const checkLabelStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
  fontSize: 11, color: 'var(--text-dim)',
}

function DefaultValueNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const {
    targetColumn = '',
    defaultValue = '',
    matchNull = true,
    matchEmpty = false,
    matchCustomEnabled = false,
    matchValue = '',
    hasRowIn = false,
    hasColIn = false,
    inputColumns = [],
  } = data

  const update = useCallback(
    (patch: Partial<DefaultValueData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const anyMatch = matchNull || matchEmpty || (matchCustomEnabled && matchValue !== '')
  const isReady  = !!(targetColumn && anyMatch && (defaultValue !== '' || hasColIn)) && inputColumns.length > 0

  const matchSummary = [
    matchNull ? 'NULL' : null,
    matchEmpty ? 'empty' : null,
    matchCustomEnabled && matchValue !== '' ? `'${matchValue}'` : null,
  ].filter(Boolean).join(' / ')

  const subtitle = isReady
    ? `"${targetColumn}": ${matchSummary} → ${hasColIn ? 'wired' : `'${defaultValue}'`}`
    : 'Configure default'

  return (
    <PipelineNode selected={selected}>
      {/* Row input — blue square at header */}
      <Handle type="target" position={Position.Left} id="row-in"
        style={rowHandle(hasRowIn, HEADER_ROW_IN)}
      />

      {/* Col input — green circle for wired default value */}
      <Handle type="target" position={Position.Left} id="col-in-default"
        style={colHandle({ top: '72%', left: -5.5, width: 11, height: 11 })}
      />

      {/* Row output — blue square at header */}
      <Handle type="source" position={Position.Right} id="row-out"
        style={rowHandle(true, HEADER_ROW_OUT)}
      />

      <NodeHeader def={defaultValueDef} id={id} subtitle={subtitle} />

      <div className="node-body">
        <div className="node-body-row">
          <span className="node-label">Column</span>
          <select
            className="node-select"
            value={targetColumn}
            onChange={(e) => update({ targetColumn: e.target.value })}
            onClick={stopProp} onMouseDown={stopProp}
            disabled={!inputColumns.length}
          >
            <option value="">— select —</option>
            {inputColumns.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Which incoming values count as missing */}
        <div className="node-body-row" style={{ marginTop: 4 }}>
          <span className="node-label">When</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
            <label style={checkLabelStyle} onClick={stopProp} onMouseDown={stopProp}>
              <input type="checkbox" checked={matchNull}
                onChange={(e) => update({ matchNull: e.target.checked })}
                style={{ cursor: 'pointer', accentColor: 'var(--blue)' }}
              />
              is NULL
            </label>
            <label style={checkLabelStyle} onClick={stopProp} onMouseDown={stopProp}>
              <input type="checkbox" checked={matchEmpty}
                onChange={(e) => update({ matchEmpty: e.target.checked })}
                style={{ cursor: 'pointer', accentColor: 'var(--blue)' }}
              />
              is empty / blank
            </label>
            <label style={checkLabelStyle} onClick={stopProp} onMouseDown={stopProp}>
              <input type="checkbox" checked={matchCustomEnabled}
                onChange={(e) => update({ matchCustomEnabled: e.target.checked })}
                style={{ cursor: 'pointer', accentColor: 'var(--blue)' }}
              />
              equals…
            </label>
          </div>
        </div>

        {matchCustomEnabled && (
          <div className="node-body-row">
            <span className="node-label">Equals</span>
            <input
              className="node-input"
              placeholder="e.g. N/A"
              value={matchValue}
              onChange={(e) => update({ matchValue: e.target.value })}
              onClick={stopProp} onMouseDown={stopProp}
            />
          </div>
        )}

        <div className="node-divider" />

        {!hasColIn && (
          <div className="node-body-row">
            <span className="node-label">Default</span>
            <input
              className="node-input"
              placeholder="fallback value…"
              value={defaultValue}
              onChange={(e) => update({ defaultValue: e.target.value })}
              onClick={stopProp} onMouseDown={stopProp}
            />
          </div>
        )}

        {hasColIn && (
          <div className="node-hint" style={{ marginTop: 2 }}>
            Using wired col-in as default
          </div>
        )}
      </div>

      <div className="status-row">
        <div className={`status-dot ${isReady ? 'ready' : 'pending'}`} />
        <span className="status-text">
          {!hasRowIn ? 'Connect a row input'
            : !targetColumn ? 'Pick a target column'
            : !anyMatch ? 'Pick at least one condition'
            : !hasColIn && defaultValue === '' ? 'Set a default or wire col-in'
            : `${matchSummary} in "${targetColumn}" → ${hasColIn ? 'wired value' : `'${defaultValue}'`}`}
        </span>
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(DefaultValueNode)

// ── Node definition & registration ───────────────────────────────────────────
export const defaultValueDef: NodeDef<DefaultValueData> = {
  type: 'default-value',
  category: 'operation',
  name: 'Default Value',
  desc: 'Replace NULL / empty / sentinel values with a fallback',
  Icon: Replace,
  help: {
    summary: 'COALESCE-style cleanup for one column. Pick which incoming values count as missing — NULL, empty/blank strings, or a specific sentinel value (e.g. "N/A") — and replace them with a fallback. Everything else passes through unchanged.',
    inputs: 'Row stream (blue square). Optional col-in (green circle) — when wired, the emitter\'s value is used as the fallback instead of the typed literal.',
    outputs: 'The same row stream with matching values in the target column replaced.',
    tips: [
      'Check multiple conditions to catch NULL and empty strings in one pass.',
      'Use "equals…" to normalize sentinel values like N/A, -, or unknown.',
      'A purely numeric default (e.g. 0) is emitted as a number, anything else as text.',
      'Wire a Static Value node to col-in for a shared constant fallback.',
      'Chain several Default Value nodes to clean multiple columns.',
    ],
  },
  inputPorts:  [{ type: 'row' }, { type: 'col' }],
  outputPorts: [{ type: 'row' }],
  defaultData: () => ({
    targetColumn: '', defaultValue: '',
    matchNull: true, matchEmpty: false, matchCustomEnabled: false, matchValue: '',
    hasRowIn: false, hasColIn: false, inputColumns: [],
  }),
  Component: Memoized,
}

registerNode(defaultValueDef)

export default Memoized
