import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { Braces, Plus, X } from 'lucide-react'
import { v4 as uuid } from 'uuid'
import type { AppNode, BuildJsonObjectData } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { colHandle, HEADER_ROW_TOP } from './shared/handles'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: BuildJsonObjectData }>

function BuildJsonObjectNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const { columnName = 'json_obj', fields = [], hasAnchor = false } = data

  const update = useCallback(
    (patch: Partial<BuildJsonObjectData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const addField    = useCallback(() => update({ fields: [...fields, { id: uuid(), key: '', sourceColumn: '' }] }), [fields, update])
  const removeField = useCallback((fid: string) => update({ fields: fields.filter((f) => f.id !== fid) }), [fields, update])
  const updateField = useCallback(
    (fid: string, col: 'key' | 'sourceColumn', val: string) =>
      update({ fields: fields.map((f) => f.id === fid ? { ...f, [col]: val } : f) }),
    [fields, update]
  )

  const isReady  = !!(columnName && fields.some((f) => f.key && f.sourceColumn))
  const subtitle = isReady
    ? `"${columnName}" · ${fields.length} field${fields.length !== 1 ? 's' : ''}`
    : 'Configure fields'

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

      <NodeHeader def={buildJsonObjectDef} id={id} subtitle={subtitle} />

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
      </div>

      {/* Key → source column table */}
      <div className="map-table">
        <div className="map-table-header">
          <span style={{ flex: 1 }}>JSON key</span>
          <span style={{ flex: 1 }}>Source col</span>
          <span style={{ width: 20 }} />
        </div>
        {fields.map((f) => (
          <div key={f.id} className="map-table-row">
            <input
              className="node-input map-input"
              placeholder="key…"
              value={f.key}
              onChange={(e) => updateField(f.id, 'key', e.target.value)}
              onClick={stopProp} onMouseDown={stopProp}
            />
            <input
              className="node-input map-input"
              placeholder="column…"
              value={f.sourceColumn}
              onChange={(e) => updateField(f.id, 'sourceColumn', e.target.value)}
              onClick={stopProp} onMouseDown={stopProp}
            />
            <button className="map-remove-btn" onClick={() => removeField(f.id)} title="Remove">
              <X size={9} strokeWidth={2.5} />
            </button>
          </div>
        ))}
        <button className="map-add-btn" onClick={addField} onMouseDown={stopProp}>
          <Plus size={10} strokeWidth={2.5} />Add field
        </button>
      </div>

      {/* Port legend */}
      <div className="emitter-legend">
        <span className="emitter-legend-item">
          <span className="emitter-dot emitter-dot-anchor" />
          anchor
        </span>
        <span className="emitter-legend-item emitter-legend-right">
          col out
          <span className="emitter-dot emitter-dot-col" />
        </span>
      </div>

      <div className="status-row">
        <div className={`status-dot ${isReady ? 'ready' : 'pending'}`} />
        <span className="status-text">
          {!columnName ? 'Set an output column name'
            : !fields.length ? 'Add at least one field'
            : `${fields.length} field${fields.length !== 1 ? 's' : ''} defined`}
        </span>
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(BuildJsonObjectNode)

// ── Node definition & registration ───────────────────────────────────────────
export const buildJsonObjectDef: NodeDef<BuildJsonObjectData> = {
  type: 'build-json-object',
  category: 'emitter',
  name: 'Build JSON',
  desc: 'Compose columns into a JSON object column',
  Icon: Braces,
  help: {
    summary: 'Builds a JSON object column by combining values from multiple upstream columns. Each row in the output contains a JSON object whose keys and values you define.',
    inputs: 'Anchor (amber square) — a row stream that sets the row count context.',
    outputs: 'One column output (green circle). Wire to a Destination col-in to supply the JSON column.',
    tips: [
      'Source columns must exist in the Destination\'s upstream data.',
      'NULL column values produce null JSON values in the object.',
      'Column names are case-sensitive — match them exactly as they appear upstream.',
      'Wire col-out to a Transform if you need to further process the JSON.',
    ],
  },
  inputPorts:  [],
  outputPorts: [{ type: 'col' }],
  defaultData: () => ({ columnName: 'json_obj', fields: [], hasAnchor: false }),
  Component: Memoized,
}

registerNode(buildJsonObjectDef)

export default Memoized
