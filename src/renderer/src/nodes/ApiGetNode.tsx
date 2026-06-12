import { memo, useState, useCallback } from 'react'
import { Handle, Position, useReactFlow, useNodeConnections, type NodeProps } from '@xyflow/react'
import { Globe, Play, Loader, CheckCircle, AlertCircle, Plus, Trash2 } from 'lucide-react'
import type { AppNode, AppEdge, ApiGetNodeData, ApiHeader } from '../lib/types'
import { executeApiNode } from '../lib/apiExec'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, tokenHandle, TOP_RIGHT_ROW_OUT } from './shared/handles'
import { ColumnList } from './shared/columns'

// ── Shared UI helpers (request logic lives in lib/apiExec.ts) ─────────────────

export function formatLastFetched(ts?: string): string {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return new Date(ts).toLocaleDateString()
}

export function HeadersEditor({
  headers, onChange,
}: { headers: ApiHeader[]; onChange: (h: ApiHeader[]) => void }) {
  const addRow = () => onChange([...headers, { id: crypto.randomUUID(), key: '', value: '' }])
  const remove = (id: string) => onChange(headers.filter((h) => h.id !== id))
  const edit = (id: string, field: 'key' | 'value', val: string) =>
    onChange(headers.map((h) => (h.id === id ? { ...h, [field]: val } : h)))

  return (
    <div style={{ marginTop: 6 }}>
      {headers.map((h) => (
        <div key={h.id} style={{ display: 'flex', gap: 4, marginBottom: 3, alignItems: 'center' }}>
          <input
            className="node-input"
            style={{ flex: 1 }}
            placeholder="Header"
            value={h.key}
            onChange={(e) => edit(h.id, 'key', e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <input
            className="node-input"
            style={{ flex: 2 }}
            placeholder="Value"
            value={h.value}
            onChange={(e) => edit(h.id, 'value', e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => remove(h.id)}
            onMouseDown={(e) => e.stopPropagation()}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
          >
            <Trash2 size={11} />
          </button>
        </div>
      ))}
      <button
        onClick={addRow}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 10, padding: '2px 0' }}
      >
        <Plus size={10} /> Add header
      </button>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = NodeProps<AppNode & { data: ApiGetNodeData }>

function ApiGetNodeComponent({ id, data, selected }: Props) {
  const { getNodes, getEdges, setNodes } = useReactFlow()
  const { url = '', headers = [], columns = [], rowCount, status, error, lastFetched } = data
  const [showHeaders, setShowHeaders] = useState(false)

  const update = useCallback(
    (patch: Partial<ApiGetNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )

  // Reactive — re-renders when the token wire is connected/removed
  const tokenConnected = useNodeConnections({ handleType: 'target', handleId: 'token-in' }).length > 0

  const handleFetch = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    update({ status: 'fetching', error: undefined })
    try {
      const nodes = getNodes() as AppNode[]
      const edges = getEdges() as AppEdge[]
      const node = nodes.find((n) => n.id === id)
      if (!node) return
      update(await executeApiNode(node, nodes, edges))
    } catch (err) {
      update({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  }, [id, getEdges, getNodes, update])

  const hasOutput = !!data.jsonPath && columns.length > 0
  const isLoading = status === 'fetching'

  const btnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
    padding: '5px 10px', borderRadius: 6, cursor: isLoading ? 'default' : 'pointer',
    fontSize: 11, fontWeight: 600, border: '1px solid',
    background: error ? 'rgba(239,68,68,0.1)' : hasOutput ? 'rgba(34,197,94,0.1)' : 'rgba(249,115,22,0.1)',
    borderColor: error ? 'var(--red)' : hasOutput ? 'var(--green-dark)' : '#f97316',
    color: error ? 'var(--red)' : hasOutput ? 'var(--green)' : '#f97316',
  }

  const BtnIcon = isLoading ? Loader : error ? AlertCircle : hasOutput ? CheckCircle : Play
  const btnLabel = isLoading ? 'Fetching…' : error ? 'Failed — retry?' : hasOutput ? 'Re-fetch' : 'Fetch'

  const subtitle = hasOutput
    ? `${rowCount != null ? rowCount.toLocaleString() + ' rows' : 'Fetched'}${lastFetched ? ' · ' + formatLastFetched(lastFetched) : ''}`
    : status === 'fetching' ? 'Fetching…' : 'Not fetched'

  const def = data.method === 'DELETE' ? apiDeleteDef : apiGetDef

  return (
    <PipelineNode selected={selected}>
      {/* Token input — left */}
      <Handle
        type="target"
        position={Position.Left}
        id="token-in"
        style={tokenHandle(tokenConnected, { top: 23, left: -7 })}
      />
      {/* Row output — top-right */}
      <Handle
        type="source"
        position={Position.Right}
        id="row-out"
        style={rowHandle(hasOutput, TOP_RIGHT_ROW_OUT)}
      />

      <NodeHeader def={def} id={id} subtitle={subtitle} />

      <div className="node-body">
        <input
          className="node-input"
          style={{ width: '100%' }}
          placeholder="https://api.example.com/data"
          value={url}
          onChange={(e) => update({ url: e.target.value })}
          onMouseDown={(e) => e.stopPropagation()}
        />

        <button
          onClick={() => setShowHeaders((v) => !v)}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 10, padding: '4px 0', textAlign: 'left' }}
        >
          {showHeaders ? '▾' : '▸'} Headers {headers.length > 0 ? `(${headers.length})` : ''}
        </button>

        {showHeaders && (
          <HeadersEditor
            headers={headers}
            onChange={(h) => update({ headers: h })}
          />
        )}

        <button style={btnStyle} onClick={handleFetch} onMouseDown={(e) => e.stopPropagation()} disabled={isLoading}>
          <BtnIcon size={12} strokeWidth={2.5} className={isLoading ? 'spin' : undefined} />
          {btnLabel}
        </button>

        {error && (
          <div style={{ marginTop: 6, fontSize: 10, color: 'var(--red)', wordBreak: 'break-all' }}>{error}</div>
        )}
      </div>

      <ColumnList columns={columns} />
    </PipelineNode>
  )
}

const Memoized = memo(ApiGetNodeComponent)

// ── GET node definition ───────────────────────────────────────────────────────

export const apiGetDef: NodeDef<ApiGetNodeData> = {
  type: 'api-get',
  category: 'api',
  name: 'GET Request',
  desc: 'Fetch data from an HTTP endpoint',
  Icon: Globe,
  help: {
    summary: 'Makes an HTTP GET request and stores the JSON response as a queryable table.',
    outputs: 'Row stream and one column handle per response field.',
    tips: [
      'Connect an API Auth node to the token input to inject a bearer token automatically.',
      'Click Fetch to load data; click Re-fetch to refresh with the latest response.',
    ],
  },
  inputPorts: [],
  outputPorts: [{ type: 'row' }, { type: 'col' }],
  defaultData: () => ({ method: 'GET', url: '', headers: [], jsonPath: null, columns: [], rowCount: null, status: 'idle' }),
  Component: Memoized,
}

registerNode(apiGetDef)

// ── DELETE node definition ────────────────────────────────────────────────────

export const apiDeleteDef: NodeDef<ApiGetNodeData> = {
  type: 'api-delete',
  category: 'api',
  name: 'DELETE Request',
  desc: 'Send an HTTP DELETE and capture response',
  Icon: Globe,
  help: {
    summary: 'Makes an HTTP DELETE request and stores the JSON response as a queryable table.',
    outputs: 'Row stream and one column handle per response field.',
    tips: ['Connect an API Auth node to inject a bearer token automatically.'],
  },
  inputPorts: [],
  outputPorts: [{ type: 'row' }, { type: 'col' }],
  defaultData: () => ({ method: 'DELETE', url: '', headers: [], jsonPath: null, columns: [], rowCount: null, status: 'idle' }),
  Component: Memoized,
}

registerNode(apiDeleteDef)

export default Memoized
