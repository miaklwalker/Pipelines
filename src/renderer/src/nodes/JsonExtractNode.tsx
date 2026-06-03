import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { FileJson, Plus, X } from 'lucide-react'
import { v4 as uuid } from 'uuid'
import type { AppNode, JsonExtractNodeData, JsonFieldType } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, colHandle } from './shared/handles'
import { ColumnList } from './shared/columns'

const FIELD_TYPES: JsonFieldType[] = ['TEXT', 'INTEGER', 'DOUBLE', 'BOOLEAN', 'JSON']

type Props = NodeProps<AppNode & { data: JsonExtractNodeData }>

function JsonExtractNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const { sourceColumn = 'item', keepAll = true, fields = [], inputColumns = [] } = data

  const update = useCallback(
    (patch: Partial<JsonExtractNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const addField = useCallback(() => {
    update({ fields: [...fields, { id: uuid(), path: '', alias: '', type: 'TEXT' }] })
  }, [fields, update])
  const removeField = useCallback((fieldId: string) => {
    update({ fields: fields.filter((f) => f.id !== fieldId) })
  }, [fields, update])
  const updateField = useCallback((fieldId: string, patch: Partial<JsonExtractNodeData['fields'][number]>) => {
    update({ fields: fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)) })
  }, [fields, update])

  const hasInput = inputColumns.length > 0
  const readyFields = fields.filter((f) => f.alias.trim() && f.path.trim())
  const isReady = hasInput && !!sourceColumn && readyFields.length > 0
  const outputColumns = keepAll
    ? [
        ...inputColumns,
        ...readyFields.map((f) => ({ name: f.alias, type: f.type === 'JSON' ? 'JSON' : 'TEXT' })),
      ]
    : readyFields.map((f) => ({ name: f.alias, type: f.type === 'JSON' ? 'JSON' : 'TEXT' }))

  const subtitle = isReady
    ? `${sourceColumn} · ${readyFields.length} field${readyFields.length !== 1 ? 's' : ''}`
    : hasInput ? 'Configure JSON fields' : 'No input connected'

  return (
    <PipelineNode selected={selected}>
      <Handle type="target" position={Position.Left} id="row-in"
        style={rowHandle(hasInput, { top: '50%', left: -7 })}
      />
      <Handle type="source" position={Position.Right} id="row-out"
        style={rowHandle(true, { top: '50%', right: -7 })}
      />

      <NodeHeader def={jsonExtractDef} id={id} subtitle={subtitle} />

      <div className="node-body">
        <div className="node-body-row">
          <span className="node-label">Source</span>
          {hasInput ? (
            <select
              className="node-select map-input"
              value={sourceColumn}
              onChange={(e) => update({ sourceColumn: e.target.value })}
              onClick={stopProp} onMouseDown={stopProp}
            >
              <option value="">— pick JSON column —</option>
              {inputColumns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          ) : (
            <input className="node-input" disabled placeholder="connect input first" />
          )}
        </div>

        <div className="node-body-row">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11.5, color: 'var(--text-dim)' }} onClick={stopProp} onMouseDown={stopProp}>
            <input
              type="checkbox"
              checked={keepAll}
              onChange={(e) => update({ keepAll: e.target.checked })}
              style={{ cursor: 'pointer', accentColor: 'var(--blue)' }}
            />
            Keep all input columns
          </label>
        </div>
      </div>

      <div className="map-table">
        <div className="map-table-header">
          <span style={{ flex: 1 }}>Path</span>
          <span style={{ flex: 1 }}>Alias</span>
          <span style={{ width: 110 }}>Type</span>
          <span style={{ width: 20 }} />
        </div>

        {fields.map((field) => (
          <div key={field.id} className="map-table-row">
            <input
              className="node-input map-input"
              style={{ flex: 1 }}
              placeholder="sku or $.sku"
              value={field.path}
              onChange={(e) => updateField(field.id, { path: e.target.value })}
              onClick={stopProp} onMouseDown={stopProp}
            />
            <input
              className="node-input map-input"
              style={{ flex: 1 }}
              placeholder="output name"
              value={field.alias}
              onChange={(e) => updateField(field.id, { alias: e.target.value })}
              onClick={stopProp} onMouseDown={stopProp}
            />
            <select
              className="node-select map-input"
              style={{ width: 110 }}
              value={field.type}
              onChange={(e) => updateField(field.id, { type: e.target.value as JsonFieldType })}
              onClick={stopProp} onMouseDown={stopProp}
            >
              {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button className="map-remove-btn" onClick={() => removeField(field.id)} title="Remove">
              <X size={9} strokeWidth={2.5} />
            </button>
          </div>
        ))}

        <button className="map-add-btn" onClick={addField} onMouseDown={stopProp}>
          <Plus size={10} strokeWidth={2.5} />Add field
        </button>
      </div>

      <div className="node-hint">
        Use <code>sku</code> or <code>$.sku</code> for paths. Set a field type if you want numeric/boolean casting.
      </div>

      {isReady && outputColumns.length > 0 && (
        <ColumnList columns={outputColumns} />
      )}

      <div className="status-row">
        <div className={`status-dot ${isReady ? 'ready' : 'pending'}`} />
        <span className="status-text">
          {!hasInput ? 'Connect a row input'
            : !sourceColumn ? 'Select the JSON source column'
            : !fields.length ? 'Add one or more fields'
            : `${readyFields.length} field${readyFields.length !== 1 ? 's' : ''} configured`}
        </span>
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(JsonExtractNode)

export const jsonExtractDef: NodeDef<JsonExtractNodeData> = {
  type: 'json-extract',
  category: 'operation',
  name: 'Extract JSON',
  desc: 'Turn JSON fields into columns',
  Icon: FileJson,
  help: {
    summary: 'Extracts fields from a JSON string column into real output columns using DuckDB JSON functions.',
    inputs: 'Row stream (blue square).',
    outputs: 'Row stream with extracted columns appended, plus per-column handles for each extracted field.',
    tips: [
      'Point it at the item column from Unnest, then add paths like sku, qty, price.',
      'Use TEXT for string values or JSON to keep nested objects intact.',
      'Turn off Keep all input columns if you only want the extracted fields.',
    ],
  },
  inputPorts: [{ type: 'row' }],
  outputPorts: [{ type: 'row' }, { type: 'col' }],
  defaultData: () => ({ sourceColumn: 'item', keepAll: true, fields: [], inputColumns: [] }),
  Component: Memoized,
}

registerNode(jsonExtractDef)

export default Memoized