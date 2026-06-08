import { memo, useState, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { KeyRound, Play, Loader, CheckCircle, AlertCircle } from 'lucide-react'
import type { AppNode, ApiAuthNodeData } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { tokenHandle } from './shared/handles'
import { buildHeaders, formatLastFetched, HeadersEditor } from './ApiGetNode'

// ── Component ─────────────────────────────────────────────────────────────────

type Props = NodeProps<AppNode & { data: ApiAuthNodeData }>

function ApiAuthNodeComponent({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const {
    url = '', method = 'POST', headers = [], body = '',
    tokenPath = '$.access_token', headerName = 'Authorization',
    headerTemplate = 'Bearer {{token}}',
    token, status, error, lastFetched,
  } = data
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showHeaders, setShowHeaders] = useState(false)

  const update = useCallback(
    (patch: Partial<ApiAuthNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )

  const handleFetch = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!url.trim()) { update({ status: 'error', error: 'Enter the auth URL first' }); return }
    update({ status: 'fetching', error: undefined })
    try {
      const hdrs = buildHeaders(headers)
      const result = await window.api.apiAuth({
        url: url.trim(), method, headers: hdrs,
        body: body.trim() || undefined,
        tokenPath: tokenPath.trim() || '$.access_token',
      })
      update({ token: result.token, status: 'done', error: undefined, lastFetched: new Date().toISOString() })
    } catch (err) {
      update({ token: undefined, status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  }, [id, url, method, headers, body, tokenPath, update])

  const hasToken = !!token
  const isLoading = status === 'fetching'

  const btnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
    padding: '5px 10px', borderRadius: 6, cursor: isLoading ? 'default' : 'pointer',
    fontSize: 11, fontWeight: 600, border: '1px solid',
    background: error ? 'rgba(239,68,68,0.1)' : hasToken ? 'rgba(34,197,94,0.1)' : 'rgba(249,115,22,0.1)',
    borderColor: error ? 'var(--red)' : hasToken ? 'var(--green-dark)' : '#f97316',
    color: error ? 'var(--red)' : hasToken ? 'var(--green)' : '#f97316',
  }

  const BtnIcon = isLoading ? Loader : error ? AlertCircle : hasToken ? CheckCircle : Play
  const btnLabel = isLoading ? 'Authenticating…' : error ? 'Failed — retry?' : hasToken ? 'Re-authenticate' : 'Get Token'

  const subtitle = hasToken
    ? `Token acquired${lastFetched ? ' · ' + formatLastFetched(lastFetched) : ''}`
    : status === 'fetching' ? 'Authenticating…' : 'No token'

  return (
    <PipelineNode selected={selected}>
      {/* Token output — bottom center */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="token-out"
        style={tokenHandle(hasToken, { bottom: -6, left: '50%', transform: 'translateX(-50%)' })}
      />

      <NodeHeader def={apiAuthDef} id={id} subtitle={subtitle} />

      <div className="node-body">
        {/* Method + URL row */}
        <div style={{ display: 'flex', gap: 4 }}>
          <select
            className="node-input"
            style={{ width: 70, flexShrink: 0 }}
            value={method}
            onChange={(e) => update({ method: e.target.value as 'GET' | 'POST' })}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <option value="POST">POST</option>
            <option value="GET">GET</option>
          </select>
          <input
            className="node-input"
            style={{ flex: 1 }}
            placeholder="https://auth.example.com/token"
            value={url}
            onChange={(e) => update({ url: e.target.value })}
            onMouseDown={(e) => e.stopPropagation()}
          />
        </div>

        {method === 'POST' && (
          <textarea
            className="node-input"
            style={{ width: '100%', marginTop: 4, minHeight: 48, resize: 'vertical', fontFamily: 'monospace', fontSize: 10 }}
            placeholder='{"client_id": "...", "client_secret": "..."}'
            value={body}
            onChange={(e) => update({ body: e.target.value })}
            onMouseDown={(e) => e.stopPropagation()}
          />
        )}

        <button
          onClick={() => setShowHeaders((v) => !v)}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 10, padding: '4px 0', textAlign: 'left' }}
        >
          {showHeaders ? '▾' : '▸'} Headers {headers.length > 0 ? `(${headers.length})` : ''}
        </button>
        {showHeaders && <HeadersEditor headers={headers} onChange={(h) => update({ headers: h })} />}

        {/* Token config */}
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 10, padding: '4px 0', textAlign: 'left' }}
        >
          {showAdvanced ? '▾' : '▸'} Token config
        </button>

        {showAdvanced && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 80, flexShrink: 0 }}>Token path</span>
              <input
                className="node-input"
                style={{ flex: 1 }}
                placeholder="$.access_token"
                value={tokenPath}
                onChange={(e) => update({ tokenPath: e.target.value })}
                onMouseDown={(e) => e.stopPropagation()}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 80, flexShrink: 0 }}>Header name</span>
              <input
                className="node-input"
                style={{ flex: 1 }}
                placeholder="Authorization"
                value={headerName}
                onChange={(e) => update({ headerName: e.target.value })}
                onMouseDown={(e) => e.stopPropagation()}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 80, flexShrink: 0 }}>Template</span>
              <input
                className="node-input"
                style={{ flex: 1 }}
                placeholder="Bearer {{token}}"
                value={headerTemplate}
                onChange={(e) => update({ headerTemplate: e.target.value })}
                onMouseDown={(e) => e.stopPropagation()}
              />
            </div>
          </div>
        )}

        <button style={btnStyle} onClick={handleFetch} onMouseDown={(e) => e.stopPropagation()} disabled={isLoading}>
          <BtnIcon size={12} strokeWidth={2.5} className={isLoading ? 'spin' : undefined} />
          {btnLabel}
        </button>

        {error && (
          <div style={{ marginTop: 6, fontSize: 10, color: 'var(--red)', wordBreak: 'break-all' }}>{error}</div>
        )}

        {hasToken && (
          <div style={{ marginTop: 4, padding: '3px 6px', background: 'rgba(34,197,94,0.08)', borderRadius: 4, fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {token!.slice(0, 40)}{token!.length > 40 ? '…' : ''}
          </div>
        )}
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(ApiAuthNodeComponent)

// ── Node definition ───────────────────────────────────────────────────────────

export const apiAuthDef: NodeDef<ApiAuthNodeData> = {
  type: 'api-auth',
  category: 'api',
  name: 'API Auth',
  desc: 'Fetch and forward a bearer token',
  Icon: KeyRound,
  help: {
    summary: 'Makes an authentication request and extracts a token from the response. The token is passed to downstream API nodes via the token-out handle.',
    outputs: 'Token handle (orange circle at bottom) — connect to a token-in handle on any API request node.',
    tips: [
      'Token path uses dot notation: $.access_token, $.data.token, etc.',
      'The header template supports {{token}} as a placeholder (default: "Bearer {{token}}").',
      'Click Re-authenticate to refresh the token manually.',
    ],
  },
  inputPorts: [],
  outputPorts: [],
  defaultData: () => ({
    method: 'POST', url: '', headers: [], body: '',
    tokenPath: '$.access_token', headerName: 'Authorization',
    headerTemplate: 'Bearer {{token}}', token: undefined,
    status: 'idle',
  }),
  Component: Memoized,
}

registerNode(apiAuthDef)

export default Memoized
