import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { Terminal, Loader, CheckCircle, AlertCircle } from 'lucide-react'
import type { AppNode, RawQueryNodeData } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { connHandle } from './shared/handles'
import { usePipelineActions } from '../contexts/PipelineActionsContext'

type Props = NodeProps<AppNode & { data: RawQueryNodeData }>

function RawQueryNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const { runSink } = usePipelineActions()
  const {
    sql = '',
    status = 'idle',
    rowCount = null,
    error,
    resolvedConfig,
  } = data

  const update = useCallback(
    (patch: Partial<RawQueryNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const handleRun = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    runSink(id)
  }, [id, runSink])

  const isConnected = !!resolvedConfig
  const canRun = isConnected && !!sql.trim() && status !== 'running'

  const subtitle = status === 'done'
    ? (rowCount != null ? `${rowCount} row${rowCount === 1 ? '' : 's'} affected` : 'Query executed')
    : status === 'running' ? 'Running…'
    : status === 'error'   ? 'Query failed'
    : isConnected          ? 'Ready'
    : 'Connect a database'

  return (
    <PipelineNode selected={selected} title="">
      <Handle type="target" position={Position.Left} id="conn-in"
        style={connHandle(isConnected, { top: 36, left: -7 })}
      />

      <NodeHeader def={rawQueryDef} id={id} subtitle={subtitle} />

      <div className="filter-io-legend">
        <div className="filter-io-row">
          <div style={{ width: 8, height: 8, borderRadius: 2, background: '#7c3aed', border: '1px solid #5b21b6', flexShrink: 0 }} />
          <span>connection</span>
        </div>
      </div>

      <div className="node-body">
        <div className="node-label" style={{ marginBottom: 4 }}>SQL</div>
        <textarea
          className="node-input"
          style={{
            width: '100%', minHeight: 80, resize: 'vertical',
            fontFamily: 'monospace', fontSize: 11, lineHeight: 1.5,
            padding: '4px 6px', boxSizing: 'border-box',
          }}
          value={sql}
          placeholder={'UPDATE users SET status = \'active\'\nWHERE last_login > now() - interval \'30 days\''}
          onChange={(e) => update({ sql: e.target.value, status: 'idle', error: undefined, rowCount: null })}
          onMouseDown={stopProp}
          onClick={stopProp}
          spellCheck={false}
        />

        <button
          className={`db-fetch-btn${canRun ? '' : ' disabled'}`}
          onClick={handleRun}
          disabled={!canRun}
          style={{ marginTop: 4 }}
        >
          {status === 'running'
            ? <><Loader size={11} strokeWidth={2} className="spin" />Running…</>
            : status === 'done'
            ? <><CheckCircle size={11} strokeWidth={2} />Run Again</>
            : <>Run Query</>}
        </button>

        {error && <div className="db-error-msg">{error}</div>}
      </div>

      <div className="status-row">
        <div className={`status-dot ${status === 'done' ? 'ready' : status === 'error' ? 'error' : 'pending'}`} />
        <span className="status-text">
          {!isConnected      ? 'Connect a database node'
            : !sql.trim()    ? 'Enter a SQL query above'
            : status === 'idle'    ? 'Ready to run'
            : status === 'running' ? 'Running query…'
            : status === 'done'    ? subtitle
            : 'Query failed — check error above'}
        </span>
        {status === 'done'  && <CheckCircle size={10} strokeWidth={2} style={{ marginLeft: 'auto', color: 'var(--green)' }} />}
        {status === 'error' && <AlertCircle size={10} strokeWidth={2} style={{ marginLeft: 'auto', color: 'var(--red)' }} />}
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(RawQueryNode)

export const rawQueryDef: NodeDef<RawQueryNodeData> = {
  type: 'raw-query',
  category: 'database',
  name: 'Raw Query',
  desc: 'Execute arbitrary SQL against a connected database',
  Icon: Terminal,
  help: {
    summary: 'Sends any SQL statement directly to a PostgreSQL database. Useful for DDL changes, custom UPDATE/DELETE logic, or any operation not covered by other nodes.',
    inputs: 'Connection (violet square).',
    outputs: 'None — this is a terminal node.',
    tips: [
      'Works for any SQL: UPDATE, DELETE, INSERT, CREATE, DROP, TRUNCATE, etc.',
      'Runs as part of the pipeline when the Run button is pressed.',
      'The row count shown reflects the number of rows affected (from Postgres rowCount).',
      'Use sequence wires to control the order relative to other sink nodes.',
    ],
  },
  inputPorts:  [{ type: 'conn' }],
  outputPorts: [],
  defaultData: () => ({
    sql: '',
    status: 'idle',
    rowCount: null,
    resolvedConfig: null,
  }),
  Component: Memoized,
}

registerNode(rawQueryDef)

export default Memoized
