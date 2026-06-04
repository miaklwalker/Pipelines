import { memo, useCallback, useState } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { FileJson, Plus, X } from 'lucide-react'
import { v4 as uuid } from 'uuid'
import { buildNodeSQL } from '../lib/sqlBuilder'
import type { AppNode, AppEdge, JsonExtractNodeData, JsonFieldType } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, colHandle } from './shared/handles'
import { ColumnList } from './shared/columns'

const FIELD_TYPES: JsonFieldType[] = ['TEXT', 'INTEGER', 'DOUBLE', 'BOOLEAN', 'JSON']

type Props = NodeProps<AppNode & { data: JsonExtractNodeData }>

type ValueKind = 'string' | 'int' | 'double' | 'boolean' | 'json'

function toAlias(key: string): string {
  const normalized = key.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized || 'field'
}

function classifyValue(value: unknown): ValueKind {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'double'
  if (value && typeof value === 'object') return 'json'
  return 'string'
}

function inferFieldType(kinds: Set<ValueKind>): JsonFieldType {
  if (kinds.has('json')) return 'JSON'
  if (kinds.size === 1 && kinds.has('boolean')) return 'BOOLEAN'
  if (kinds.has('double')) return 'DOUBLE'
  if (kinds.has('int') && !kinds.has('string')) return 'INTEGER'
  return 'TEXT'
}

function extractJsonKeys(rows: (string | null)[][]): Array<{ key: string; type: JsonFieldType }> {
  const stats = new Map<string, Set<ValueKind>>()

  for (const row of rows) {
    const raw = row[0]
    if (!raw) continue
    const text = String(raw).trim()
    if (!text) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      continue
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue

    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!stats.has(key)) stats.set(key, new Set<ValueKind>())
      if (value === null) continue
      stats.get(key)?.add(classifyValue(value))
    }
  }

  return [...stats.entries()]
    .map(([key, kinds]) => ({ key, type: inferFieldType(kinds) }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

function JsonExtractNode({ id, data, selected }: Props) {
  const { setNodes, getNodes, getEdges } = useReactFlow()
  const { sourceColumn = 'item', keepAll = true, fields = [], inputColumns = [] } = data
  const [detectingKeys, setDetectingKeys] = useState(false)
  const [detectError, setDetectError] = useState<string | null>(null)

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

  const detectKeys = useCallback(async (columnName: string, replaceExisting: boolean) => {
    if (!columnName) return

    setDetectError(null)
    setDetectingKeys(true)
    try {
      const nodes = getNodes() as AppNode[]
      const edges = getEdges() as AppEdge[]
      const incoming = edges.find((e) => e.target === id && (e.targetHandle ?? 'row-in') === 'row-in')
      if (!incoming) {
        setDetectError('Connect a row input first.')
        return
      }

      const upstreamSQL = buildNodeSQL(incoming.source, nodes, edges)
      if (!upstreamSQL) {
        setDetectError('Upstream pipeline is incomplete.')
        return
      }

      const escapedCol = columnName.replace(/"/g, '""')
      const sampleSQL = `SELECT "${escapedCol}" AS "__json_source" FROM (${upstreamSQL}) __src WHERE "${escapedCol}" IS NOT NULL LIMIT 50`
      const preview = await window.api.dbPreview(sampleSQL)
      const detected = extractJsonKeys(preview.rows)
      if (detected.length === 0) {
        setDetectError('No JSON object keys were found in sample rows.')
        return
      }

      setNodes((ns) => ns.map((n) => {
        if (n.id !== id) return n
        const nodeData = n.data as JsonExtractNodeData
        const existingByPath = new Map(nodeData.fields.map((f) => [f.path.trim(), f]))
        const existingByAlias = new Map(nodeData.fields.map((f) => [f.alias.trim(), f]))
        const generated = detected.map(({ key, type }) => {
          const alias = toAlias(key)
          const existing = existingByPath.get(key) ?? existingByAlias.get(alias)
          return {
            id: existing?.id ?? uuid(),
            path: key,
            alias,
            type: existing?.type ?? type,
          }
        })

        return {
          ...n,
          data: {
            ...nodeData,
            fields: replaceExisting ? generated : [...nodeData.fields, ...generated.filter((g) => !existingByPath.has(g.path) && !existingByAlias.has(g.alias))],
          },
        }
      }))
    } catch (err) {
      setDetectError(err instanceof Error ? err.message : String(err))
    } finally {
      setDetectingKeys(false)
    }
  }, [getEdges, getNodes, id, setNodes])

  const onSourceChange = useCallback((nextSource: string) => {
    update({ sourceColumn: nextSource })
    if (nextSource) void detectKeys(nextSource, true)
  }, [detectKeys, update])

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
              onChange={(e) => onSourceChange(e.target.value)}
              onClick={stopProp} onMouseDown={stopProp}
            >
              <option value="">— pick JSON column —</option>
              {inputColumns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          ) : (
            <input className="node-input" disabled placeholder="connect input first" />
          )}
        </div>

        {detectError && (
          <div className="node-hint" style={{ marginTop: 2, color: '#e36d6d' }}>
            {detectError}
          </div>
        )}

        {detectingKeys && (
          <div className="node-hint" style={{ marginTop: 2 }}>
            Detecting keys from sample rows...
          </div>
        )}

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
        Pick a source column to auto-detect keys. You can still edit/add paths manually (for example <code>sku</code> or <code>$.sku</code>).
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