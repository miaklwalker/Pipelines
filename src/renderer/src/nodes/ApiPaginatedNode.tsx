import { memo, useState, useCallback } from 'react'
import { Handle, Position, useReactFlow, useNodeConnections, type NodeProps } from '@xyflow/react'
import { Layers, Play, Loader, CheckCircle, AlertCircle } from 'lucide-react'
import type { AppNode, AppEdge, ApiPaginatedNodeData, PaginationStrategy } from '../lib/types'
import { executeApiNode } from '../lib/apiExec'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, tokenHandle, TOP_RIGHT_ROW_OUT } from './shared/handles'
import { ColumnList } from './shared/columns'
import { formatLastFetched, HeadersEditor } from './ApiGetNode'

// ── Component ─────────────────────────────────────────────────────────────────

type Props = NodeProps<AppNode & { data: ApiPaginatedNodeData }>

function ApiPaginatedNodeComponent({ id, data, selected }: Props) {
  const { getNodes, getEdges, setNodes } = useReactFlow()
  const {
    url = '', headers = [], columns = [], rowCount,
    strategy = 'page', status, error, lastFetched,
    pageParam = 'page', pageStart = 1,
    offsetParam = 'offset', limitParam = 'limit', limitValue = 100,
    cursorPath = '', cursorParam = 'cursor', cursorIn = 'query',
    dataPath = '', maxPages = 100, failOnError = false,
    pagesFetched, hadErrors,
  } = data
  const [showHeaders, setShowHeaders] = useState(false)

  const update = useCallback(
    (patch: Partial<ApiPaginatedNodeData>) =>
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
    background: error ? 'rgba(239,68,68,0.1)' : hasOutput ? 'rgba(34,197,94,0.1)' : 'rgba(99,102,241,0.1)',
    borderColor: error ? 'var(--red)' : hasOutput ? 'var(--green-dark)' : '#6366f1',
    color: error ? 'var(--red)' : hasOutput ? 'var(--green)' : '#818cf8',
  }

  const BtnIcon = isLoading ? Loader : error ? AlertCircle : hasOutput ? CheckCircle : Play
  const btnLabel = isLoading ? 'Fetching pages…' : error ? 'Failed — retry?' : hasOutput ? 'Re-fetch all' : 'Fetch all pages'

  const subtitle = hasOutput
    ? `${rowCount != null ? rowCount.toLocaleString() + ' rows' : ''}${pagesFetched ? ', ' + pagesFetched + ' pages' : ''}${hadErrors ? ' (partial)' : ''}${lastFetched ? ' · ' + formatLastFetched(lastFetched) : ''}`
    : status === 'fetching' ? 'Fetching pages…' : 'Not fetched'

  return (
    <PipelineNode selected={selected}>
      <Handle type="target" position={Position.Left} id="token-in" style={tokenHandle(tokenConnected, { top: 23, left: -7 })} />
      <Handle type="source" position={Position.Right} id="row-out" style={rowHandle(hasOutput, TOP_RIGHT_ROW_OUT)} />

      <NodeHeader def={apiPaginatedDef} id={id} subtitle={subtitle} />

      <div className="node-body">
        <input
          className="node-input"
          style={{ width: '100%' }}
          placeholder="https://api.example.com/items"
          value={url}
          onChange={(e) => update({ url: e.target.value })}
          onMouseDown={(e) => e.stopPropagation()}
        />

        {/* Strategy selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 56, flexShrink: 0 }}>Strategy</span>
          <select
            className="node-input"
            style={{ flex: 1 }}
            value={strategy}
            onChange={(e) => update({ strategy: e.target.value as PaginationStrategy })}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <option value="page">Page number</option>
            <option value="offset">Offset / Limit</option>
            <option value="cursor">Cursor</option>
            <option value="link-header">Link header (RFC 5988)</option>
          </select>
        </div>

        {/* Strategy-specific params */}
        {strategy === 'page' && (
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            <div style={{ flex: 2 }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Param name</span>
              <input className="node-input" style={{ width: '100%' }} value={pageParam}
                onChange={(e) => update({ pageParam: e.target.value })}
                onMouseDown={(e) => e.stopPropagation()} placeholder="page" />
            </div>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Start at</span>
              <input className="node-input" style={{ width: '100%' }} type="number" value={pageStart}
                onChange={(e) => update({ pageStart: Number(e.target.value) })}
                onMouseDown={(e) => e.stopPropagation()} min={0} />
            </div>
          </div>
        )}

        {strategy === 'offset' && (
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Offset param</span>
              <input className="node-input" style={{ width: '100%' }} value={offsetParam}
                onChange={(e) => update({ offsetParam: e.target.value })}
                onMouseDown={(e) => e.stopPropagation()} placeholder="offset" />
            </div>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Limit param</span>
              <input className="node-input" style={{ width: '100%' }} value={limitParam}
                onChange={(e) => update({ limitParam: e.target.value })}
                onMouseDown={(e) => e.stopPropagation()} placeholder="limit" />
            </div>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Page size</span>
              <input className="node-input" style={{ width: '100%' }} type="number" value={limitValue}
                onChange={(e) => update({ limitValue: Number(e.target.value) })}
                onMouseDown={(e) => e.stopPropagation()} min={1} />
            </div>
          </div>
        )}

        {strategy === 'cursor' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <div style={{ flex: 2 }}>
                <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Cursor path (response)</span>
                <input className="node-input" style={{ width: '100%' }} value={cursorPath}
                  onChange={(e) => update({ cursorPath: e.target.value })}
                  onMouseDown={(e) => e.stopPropagation()} placeholder="$.meta.next_cursor" />
              </div>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Param name</span>
                <input className="node-input" style={{ width: '100%' }} value={cursorParam}
                  onChange={(e) => update({ cursorParam: e.target.value })}
                  onMouseDown={(e) => e.stopPropagation()} placeholder="cursor" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Cursor sent via</span>
              {(['query', 'body'] as const).map((v) => (
                <label key={v} style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
                  <input type="radio" checked={cursorIn === v} onChange={() => update({ cursorIn: v })}
                    onMouseDown={(e) => e.stopPropagation()} /> {v}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Data path + limits */}
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          <div style={{ flex: 2 }}>
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Data path (optional)</span>
            <input className="node-input" style={{ width: '100%' }} value={dataPath}
              onChange={(e) => update({ dataPath: e.target.value })}
              onMouseDown={(e) => e.stopPropagation()} placeholder="$.data  or  $.results" />
          </div>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Max pages</span>
            <input className="node-input" style={{ width: '100%' }} type="number" value={maxPages}
              onChange={(e) => update({ maxPages: Number(e.target.value) })}
              onMouseDown={(e) => e.stopPropagation()} min={1} max={10000} />
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-muted)', marginTop: 4, cursor: 'pointer' }}
          onMouseDown={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={failOnError}
            onChange={(e) => update({ failOnError: e.target.checked })} />
          Fail on page error (unchecked = return partial results)
        </label>

        <button
          onClick={() => setShowHeaders((v) => !v)}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 10, padding: '4px 0', textAlign: 'left' }}
        >
          {showHeaders ? '▾' : '▸'} Headers {headers.length > 0 ? `(${headers.length})` : ''}
        </button>
        {showHeaders && <HeadersEditor headers={headers} onChange={(h) => update({ headers: h })} />}

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

const Memoized = memo(ApiPaginatedNodeComponent)

// ── Node definition ───────────────────────────────────────────────────────────

export const apiPaginatedDef: NodeDef<ApiPaginatedNodeData> = {
  type: 'api-paginated',
  category: 'api',
  name: 'Paginated GET',
  desc: 'Fetch all pages from a paginated API',
  Icon: Layers,
  help: {
    summary: 'Loops through a paginated HTTP endpoint and concatenates all pages into a single queryable table.',
    outputs: 'Row stream and one column handle per response field.',
    tips: [
      'Page number: increments ?page=1, ?page=2… until response is empty.',
      'Offset/Limit: increments ?offset=0&limit=100, ?offset=100… until results < limit.',
      'Cursor: extracts next cursor from response (e.g. $.meta.next_cursor) and sends it back.',
      'Link header: reads RFC 5988 Link: <url>; rel="next" from response headers.',
      'Data path lets you unwrap a nested array: $.data, $.results.items, etc.',
    ],
  },
  inputPorts: [],
  outputPorts: [{ type: 'row' }, { type: 'col' }],
  defaultData: () => ({
    url: '', headers: [], strategy: 'page',
    pageParam: 'page', pageStart: 1,
    offsetParam: 'offset', limitParam: 'limit', limitValue: 100,
    cursorPath: '', cursorParam: 'cursor', cursorIn: 'query',
    dataPath: '', maxPages: 100, failOnError: false,
    jsonPath: null, columns: [], rowCount: null, status: 'idle',
  }),
  Component: Memoized,
}

registerNode(apiPaginatedDef)

export default Memoized
