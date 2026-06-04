import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { ArrowLeftRight, Plus, X } from 'lucide-react'
import type { AppNode, MapValueData } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { colHandle, HEADER_ROW_TOP } from './shared/handles'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: MapValueData }>

function MapValueNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const { columnName = 'mapped', sourceColumn = '', mappings = [], hasAnchor = false } = data

  const update = useCallback(
    (patch: Partial<MapValueData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const addRow    = useCallback(() => update({ mappings: [...mappings, { from: '', to: '' }] }), [mappings, update])
  const removeRow = useCallback((i: number) => update({ mappings: mappings.filter((_, idx) => idx !== i) }), [mappings, update])
  const updateRow = useCallback((i: number, field: 'from' | 'to', val: string) =>
    update({ mappings: mappings.map((m, idx) => idx === i ? { ...m, [field]: val } : m) }),
    [mappings, update]
  )

  const isReady  = !!(columnName && sourceColumn && mappings.some((m) => m.from !== ''))
  const subtitle = isReady
    ? `"${sourceColumn}" → "${columnName}" · ${mappings.length} rule${mappings.length !== 1 ? 's' : ''}`
    : 'Configure mapping'

  return (
    <PipelineNode selected={selected}>
      {/* Anchor input — amber square */}
      <Handle type="target" position={Position.Left} id="anchor-in"
        style={{
          top: HEADER_ROW_TOP, left: -7, width: 11, height: 11, borderRadius: 2,
          background: hasAnchor ? '#f59e0b' : '#44403c',
          border: `2px solid ${hasAnchor ? '#d97706' : '#292524'}`,
        }}
      />

      {/* Column output — green circle */}
      <Handle type="source" position={Position.Right} id="col-out"
        style={colHandle({ top: '50%', right: -5.5, width: 11, height: 11 })}
      />

      <NodeHeader def={mapValueDef} id={id} subtitle={subtitle} />

      <div className="node-body">
        <div className="node-body-row">
          <span className="node-label">Column</span>
          <input
            className="node-input"
            placeholder="output col name"
            value={columnName}
            onChange={(e) => update({ columnName: e.target.value })}
            onClick={stopProp} onMouseDown={stopProp}
          />
        </div>
        <div className="node-body-row">
          <span className="node-label">Source</span>
          <input
            className="node-input"
            placeholder="col to map from"
            value={sourceColumn}
            onChange={(e) => update({ sourceColumn: e.target.value })}
            onClick={stopProp} onMouseDown={stopProp}
          />
        </div>
      </div>

      {/* Value mapping table */}
      <div className="map-table">
        <div className="map-table-header">
          <span style={{ flex: 1 }}>From</span>
          <span style={{ flex: 1 }}>To</span>
          <span style={{ width: 20 }} />
        </div>
        {mappings.map((m, i) => (
          <div key={i} className="map-table-row">
            <input
              className="node-input map-input"
              placeholder="value…"
              value={m.from}
              onChange={(e) => updateRow(i, 'from', e.target.value)}
              onClick={stopProp} onMouseDown={stopProp}
            />
            <input
              className="node-input map-input"
              placeholder="output…"
              value={m.to}
              onChange={(e) => updateRow(i, 'to', e.target.value)}
              onClick={stopProp} onMouseDown={stopProp}
            />
            <button className="map-remove-btn" onClick={() => removeRow(i)} title="Remove">
              <X size={9} strokeWidth={2.5} />
            </button>
          </div>
        ))}
        <button className="map-add-btn" onClick={addRow} onMouseDown={stopProp}>
          <Plus size={10} strokeWidth={2.5} />Add row
        </button>
      </div>

      <div className="node-hint">
        Use <code>&#39;single quotes&#39;</code> for text values
      </div>

      <div className="emitter-legend">
        <span className="emitter-legend-item">
          <span className="emitter-dot emitter-dot-anchor" />anchor
        </span>
        <span className="emitter-legend-item emitter-legend-right">
          col out<span className="emitter-dot emitter-dot-col" />
        </span>
      </div>

      <div className="status-row">
        <div className={`status-dot ${isReady ? 'ready' : 'pending'}`} />
        <span className="status-text">
          {!columnName ? 'Set an output column name'
            : !sourceColumn ? 'Set the source column'
            : !mappings.length ? 'Add at least one mapping'
            : `${mappings.length} mapping${mappings.length !== 1 ? 's' : ''} defined`}
        </span>
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(MapValueNode)

// ── Node definition & registration ───────────────────────────────────────────
export const mapValueDef: NodeDef<MapValueData> = {
  type: 'map-value',
  category: 'emitter',
  name: 'Map',
  desc: 'Translate column values to outputs',
  Icon: ArrowLeftRight,
  help: {
    summary: 'Translates specific values from a source column into new output values using an exact-match lookup table. Any value not listed outputs NULL.',
    inputs: 'Anchor (amber square) — connects a row stream to set the row count context.',
    outputs: 'One column output (green circle). Wire this to a Destination col-in handle.',
    tips: [
      'Source column must exist in the Destination\'s upstream data.',
      'Matching is case-sensitive and treats all values as text.',
      'Rows whose value is not in the table will output NULL — add an extra row with a fallback value if needed.',
      'Use single quotes around text values in both From and To fields.',
    ],
  },
  inputPorts:  [],
  outputPorts: [{ type: 'col' }],
  defaultData: () => ({ columnName: 'mapped', sourceColumn: '', mappings: [], hasAnchor: false }),
  Component: Memoized,
}

registerNode(mapValueDef)

export default Memoized
