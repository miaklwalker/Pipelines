import { memo, useState, useCallback } from 'react'
import { Handle, Position, useReactFlow, useNodeConnections, type NodeProps } from '@xyflow/react'
import { Send, RefreshCw, Play, Loader, CheckCircle, AlertCircle } from 'lucide-react'
import type { AppNode, AppEdge, ApiBodyNodeData } from '../lib/types'
import { executeApiNode } from '../lib/apiExec'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, tokenHandle, HEADER_ROW_IN, TOP_RIGHT_ROW_OUT } from './shared/handles'
import { ColumnList } from './shared/columns'
import { formatLastFetched, HeadersEditor } from './ApiGetNode'

// ── Component ─────────────────────────────────────────────────────────────────

type Props = NodeProps<AppNode & { data: ApiBodyNodeData }>

function ApiBodyNodeComponent({ id, data, selected }: Props) {
  const { getNodes, getEdges, setNodes } = useReactFlow()
  const { url = '', headers = [], bodyMode = 'static', staticBody = '', columns = [], rowCount, status, error, lastFetched } = data
  const [showHeaders, setShowHeaders] = useState(false)

  const update = useCallback(
    (patch: Partial<ApiBodyNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )

  // Reactive — re-render when the token / row wires are connected or removed
  const tokenConnected = useNodeConnections({ handleType: 'target', handleId: 'token-in' }).length > 0
  const rowInConnected = useNodeConnections({ handleType: 'target', handleId: 'row-in' }).length > 0

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

  const methodColor = data.method === 'POST' ? '#6366f1' : data.method === 'PUT' ? '#8b5cf6' : '#a78bfa'

  const btnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
    padding: '5px 10px', borderRadius: 6, cursor: isLoading ? 'default' : 'pointer',
    fontSize: 11, fontWeight: 600, border: '1px solid',
    background: error ? 'rgba(239,68,68,0.1)' : hasOutput ? 'rgba(34,197,94,0.1)' : `${methodColor}1a`,
    borderColor: error ? 'var(--red)' : hasOutput ? 'var(--green-dark)' : methodColor,
    color: error ? 'var(--red)' : hasOutput ? 'var(--green)' : methodColor,
  }

  const BtnIcon = isLoading ? Loader : error ? AlertCircle : hasOutput ? CheckCircle : Play
  const btnLabel = isLoading ? 'Sending…' : error ? 'Failed — retry?' : hasOutput ? 'Re-send' : 'Send'

  const subtitle = hasOutput
    ? `${rowCount != null ? rowCount.toLocaleString() + ' rows' : 'Sent'}${lastFetched ? ' · ' + formatLastFetched(lastFetched) : ''}`
    : status === 'fetching' ? 'Sending…' : 'Not sent'

  const nodeDef = data.method === 'POST' ? apiPostDef : data.method === 'PUT' ? apiPutDef : apiPatchDef

  return (
    <PipelineNode selected={selected}>
      {/* Row input for body */}
      <Handle type="target" position={Position.Left} id="row-in" style={rowHandle(rowInConnected, HEADER_ROW_IN)} />
      {/* Token input */}
      <Handle type="target" position={Position.Left} id="token-in" style={tokenHandle(tokenConnected, { top: 40, left: -7 })} />
      {/* Row output */}
      <Handle type="source" position={Position.Right} id="row-out" style={rowHandle(hasOutput, TOP_RIGHT_ROW_OUT)} />

      <NodeHeader def={nodeDef} id={id} subtitle={subtitle} />

      <div className="node-body">
        <input
          className="node-input"
          style={{ width: '100%' }}
          placeholder="https://api.example.com/resource"
          value={url}
          onChange={(e) => update({ url: e.target.value })}
          onMouseDown={(e) => e.stopPropagation()}
        />

        {/* Body mode selector */}
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              checked={bodyMode === 'static'}
              onChange={() => update({ bodyMode: 'static' })}
              onMouseDown={(e) => e.stopPropagation()}
            />
            Static JSON
          </label>
          <label style={{ fontSize: 10, color: rowInConnected ? 'var(--text)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              checked={bodyMode === 'upstream'}
              onChange={() => update({ bodyMode: 'upstream' })}
              onMouseDown={(e) => e.stopPropagation()}
            />
            From row-in
            {bodyMode === 'upstream' && !rowInConnected && (
              <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}> (connect left ←)</span>
            )}
          </label>
        </div>

        {bodyMode === 'static' && (
          <textarea
            className="node-input"
            style={{ width: '100%', minHeight: 60, marginTop: 4, resize: 'vertical', fontFamily: 'monospace', fontSize: 10 }}
            placeholder='{"key": "value"}'
            value={staticBody}
            onChange={(e) => update({ staticBody: e.target.value })}
            onMouseDown={(e) => e.stopPropagation()}
          />
        )}

        {bodyMode === 'upstream' && rowInConnected && (
          <div style={{ marginTop: 4, padding: '4px 8px', background: 'rgba(99,102,241,0.1)', borderRadius: 4, fontSize: 10, color: '#818cf8', display: 'flex', alignItems: 'center', gap: 4 }}>
            <RefreshCw size={10} /> Upstream result sent as JSON array
          </div>
        )}

        <button
          onClick={() => setShowHeaders((v) => !v)}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 10, padding: '4px 0', textAlign: 'left' }}
        >
          {showHeaders ? '▾' : '▸'} Headers {headers.length > 0 ? `(${headers.length})` : ''}
        </button>

        {showHeaders && (
          <HeadersEditor headers={headers} onChange={(h) => update({ headers: h })} />
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

const Memoized = memo(ApiBodyNodeComponent)

// ── POST ──────────────────────────────────────────────────────────────────────

export const apiPostDef: NodeDef<ApiBodyNodeData> = {
  type: 'api-post',
  category: 'api',
  name: 'POST Request',
  desc: 'Send data via HTTP POST',
  Icon: Send,
  help: {
    summary: 'Makes an HTTP POST with a JSON body and stores the response as a queryable table.',
    inputs: 'Row stream (used as body when "From row-in" is selected).',
    outputs: 'Row stream and one column handle per response field.',
    tips: ['Connect a data source to row-in to send pipeline data as the request body.'],
  },
  inputPorts: [{ type: 'row' }],
  outputPorts: [{ type: 'row' }, { type: 'col' }],
  defaultData: () => ({ method: 'POST', url: '', headers: [], bodyMode: 'static', staticBody: '', jsonPath: null, columns: [], rowCount: null, status: 'idle', inputColumns: [] }),
  Component: Memoized,
}

registerNode(apiPostDef)

// ── PUT ───────────────────────────────────────────────────────────────────────

export const apiPutDef: NodeDef<ApiBodyNodeData> = {
  type: 'api-put',
  category: 'api',
  name: 'PUT Request',
  desc: 'Send data via HTTP PUT',
  Icon: Send,
  help: {
    summary: 'Makes an HTTP PUT with a JSON body and stores the response as a queryable table.',
    inputs: 'Row stream (used as body when "From row-in" is selected).',
    outputs: 'Row stream and one column handle per response field.',
    tips: ['Connect a data source to row-in to send pipeline data as the request body.'],
  },
  inputPorts: [{ type: 'row' }],
  outputPorts: [{ type: 'row' }, { type: 'col' }],
  defaultData: () => ({ method: 'PUT', url: '', headers: [], bodyMode: 'static', staticBody: '', jsonPath: null, columns: [], rowCount: null, status: 'idle', inputColumns: [] }),
  Component: Memoized,
}

registerNode(apiPutDef)

// ── PATCH ─────────────────────────────────────────────────────────────────────

export const apiPatchDef: NodeDef<ApiBodyNodeData> = {
  type: 'api-patch',
  category: 'api',
  name: 'PATCH Request',
  desc: 'Send partial update via HTTP PATCH',
  Icon: Send,
  help: {
    summary: 'Makes an HTTP PATCH with a JSON body and stores the response as a queryable table.',
    inputs: 'Row stream (used as body when "From row-in" is selected).',
    outputs: 'Row stream and one column handle per response field.',
    tips: ['Connect a data source to row-in to send pipeline data as the request body.'],
  },
  inputPorts: [{ type: 'row' }],
  outputPorts: [{ type: 'row' }, { type: 'col' }],
  defaultData: () => ({ method: 'PATCH', url: '', headers: [], bodyMode: 'static', staticBody: '', jsonPath: null, columns: [], rowCount: null, status: 'idle', inputColumns: [] }),
  Component: Memoized,
}

registerNode(apiPatchDef)

export default Memoized
