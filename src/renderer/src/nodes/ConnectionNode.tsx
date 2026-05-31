import { memo, useCallback, useState } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { Database, CheckCircle, XCircle, Loader } from 'lucide-react'
import type { AppNode, ConnectionNodeData, PgConfig } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { connHandle } from './shared/handles'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: ConnectionNodeData }>

const DEFAULT_CONFIG: PgConfig = { host: 'localhost', port: 5432, database: '', user: '', password: '', ssl: false }

function ConnectionNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const { config = DEFAULT_CONFIG, testStatus = 'idle', testError } = data

  const [showPass, setShowPass] = useState(false)

  const update = useCallback(
    (patch: Partial<ConnectionNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const setConfig = useCallback(
    (patch: Partial<PgConfig>) => update({ config: { ...config, ...patch } }),
    [config, update]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const handleTest = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    update({ testStatus: 'testing', testError: undefined })
    try {
      const result = await window.api.pgTest(config)
      update({ testStatus: result.ok ? 'ok' : 'error', testError: result.error })
    } catch (err) {
      update({ testStatus: 'error', testError: String(err) })
    }
  }, [config, update])

  const isReady = config.host && config.database && config.user
  const subtitle = isReady ? `${config.user}@${config.host}:${config.port}/${config.database}` : 'Configure connection'

  return (
    <PipelineNode selected={selected} title="Database connection provider">
      {/* conn-out handle — violet square */}
      <Handle type="source" position={Position.Right} id="conn-out"
        style={connHandle(true, { top: '50%', right: -7 })}
      />

      <NodeHeader def={connectionDef} subtitle={subtitle} />

      <div className="node-body" style={{ gap: 0 }}>
        {/* Host + Port */}
        <div className="node-body-row" style={{ marginBottom: 6 }}>
          <span className="node-label">Host</span>
          <input
            className="node-input"
            placeholder="localhost"
            value={config.host}
            onChange={(e) => setConfig({ host: e.target.value })}
            onClick={stopProp} onMouseDown={stopProp}
          />
          <input
            className="node-input"
            type="number"
            style={{ width: 56, flex: 'none' }}
            placeholder="5432"
            value={config.port}
            onChange={(e) => setConfig({ port: parseInt(e.target.value) || 5432 })}
            onClick={stopProp} onMouseDown={stopProp}
          />
        </div>

        {/* Database */}
        <div className="node-body-row" style={{ marginBottom: 6 }}>
          <span className="node-label">Database</span>
          <input
            className="node-input"
            placeholder="mydb"
            value={config.database}
            onChange={(e) => setConfig({ database: e.target.value })}
            onClick={stopProp} onMouseDown={stopProp}
          />
        </div>

        {/* User */}
        <div className="node-body-row" style={{ marginBottom: 6 }}>
          <span className="node-label">User</span>
          <input
            className="node-input"
            placeholder="postgres"
            value={config.user}
            onChange={(e) => setConfig({ user: e.target.value })}
            onClick={stopProp} onMouseDown={stopProp}
          />
        </div>

        {/* Password */}
        <div className="node-body-row" style={{ marginBottom: 6 }}>
          <span className="node-label">Password</span>
          <input
            className="node-input"
            type={showPass ? 'text' : 'password'}
            placeholder="••••••••"
            value={config.password}
            onChange={(e) => setConfig({ password: e.target.value })}
            onClick={stopProp} onMouseDown={stopProp}
          />
          <button
            className="db-toggle-pass"
            onClick={(e) => { e.stopPropagation(); setShowPass((v) => !v) }}
            title={showPass ? 'Hide' : 'Show'}
          >
            {showPass ? '●' : '○'}
          </button>
        </div>

        {/* SSL */}
        <div className="node-body-row" style={{ marginBottom: 8 }}>
          <span className="node-label">SSL</span>
          <label className="db-ssl-label" onClick={stopProp} onMouseDown={stopProp}>
            <input
              type="checkbox"
              checked={config.ssl}
              onChange={(e) => setConfig({ ssl: e.target.checked })}
              style={{ cursor: 'pointer', accentColor: '#7c3aed' }}
            />
            Require SSL
          </label>
        </div>

        {/* Test button */}
        <button className="db-test-btn" onClick={handleTest} disabled={testStatus === 'testing' || !isReady}>
          {testStatus === 'testing'
            ? <><Loader size={11} strokeWidth={2} className="spin" />Testing…</>
            : testStatus === 'ok'
            ? <><CheckCircle size={11} strokeWidth={2} />Connected</>
            : testStatus === 'error'
            ? <><XCircle size={11} strokeWidth={2} />Test Failed</>
            : <>Test Connection</>}
        </button>

        {testError && (
          <div className="db-error-msg">{testError}</div>
        )}
      </div>

      <div className="status-row">
        <div className={`status-dot ${testStatus === 'ok' ? 'ready' : testStatus === 'error' ? 'error' : 'pending'}`} />
        <span className="status-text">
          {!isReady ? 'Enter host, database, user'
            : testStatus === 'ok' ? 'Connection verified'
            : testStatus === 'error' ? 'Connection failed'
            : 'Click Test Connection'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 9.5, color: '#7c3aed' }}>
          conn out <div style={{ width: 8, height: 8, borderRadius: 2, background: '#7c3aed', border: '1px solid #5b21b6' }} />
        </div>
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(ConnectionNode)

// ── Node definition & registration ───────────────────────────────────────────
export const connectionDef: NodeDef<ConnectionNodeData> = {
  type: 'connection',
  category: 'database',
  name: 'Connection',
  desc: 'PostgreSQL connection config',
  Icon: Database,
  help: {
    summary: 'Stores and validates a PostgreSQL connection. Connect its output to Read Table or Write Table nodes.',
    outputs: 'A connection handle (violet square). Wire this to the conn-in port of Read or Write Table nodes.',
    tips: [
      'Click "Test Connection" to verify credentials before running a pipeline.',
      'One Connection node can feed multiple Read/Write Table nodes simultaneously.',
      'SSL mode is required by most cloud-hosted databases (Supabase, RDS, etc.).',
    ],
  },
  inputPorts:  [],
  outputPorts: [{ type: 'conn' }],
  defaultData: () => ({
    config: { ...DEFAULT_CONFIG },
    testStatus: 'idle',
  }),
  Component: Memoized,
}

registerNode(connectionDef)

export default Memoized
