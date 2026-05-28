import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { GitMerge } from 'lucide-react'
import type { AppNode, JoinNodeData } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: JoinNodeData }>

const JOIN_TYPES = ['INNER', 'LEFT', 'RIGHT', 'FULL'] as const

function JoinNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const { joinType, leftKey, rightKey, leftColumns = [], rightColumns = [] } = data

  const update = useCallback(
    (patch: Partial<JoinNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const leftReady  = leftColumns.length > 0
  const rightReady = rightColumns.length > 0
  const isReady    = leftReady && rightReady && !!leftKey && !!rightKey

  const subtitle = leftReady && rightReady
    ? `${leftColumns.length + rightColumns.length} cols`
    : 'Connect two tables'

  return (
    <div className={`pipeline-node${selected ? ' selected' : ''}`} title="Click to preview">
      {/* Left input — top (left table) */}
      <Handle type="target" position={Position.Left} id="row-left"
        style={{
          top: 42, left: -7, width: 13, height: 13, borderRadius: 3,
          background: leftReady ? 'var(--row-handle)' : '#334155',
          border: `2px solid ${leftReady ? 'var(--blue-dark)' : '#1e293b'}`,
        }}
      />
      {/* Left input — bottom (right table) */}
      <Handle type="target" position={Position.Left} id="row-right"
        style={{
          top: 78, left: -7, width: 13, height: 13, borderRadius: 3,
          background: rightReady ? 'var(--row-handle)' : '#334155',
          border: `2px solid ${rightReady ? 'var(--blue-dark)' : '#1e293b'}`,
        }}
      />
      {/* Row output */}
      <Handle type="source" position={Position.Right} id="row-out"
        style={{
          top: '50%', right: -7, width: 13, height: 13, borderRadius: 3,
          background: 'var(--row-handle)', border: '2px solid var(--blue-dark)',
        }}
      />

      <NodeHeader def={joinDef} subtitle={subtitle} />

      <div className="node-body">
        <div className="node-body-row">
          <span className="node-label">Type</span>
          <select className="node-select" value={joinType}
            onChange={(e) => update({ joinType: e.target.value as JoinNodeData['joinType'] })}
            onClick={stopProp} onMouseDown={stopProp}
          >
            {JOIN_TYPES.map((t) => <option key={t} value={t}>{t} JOIN</option>)}
          </select>
        </div>

        <div className="node-body-row">
          <span className="node-label" style={{ color: '#60a5fa' }}>Left key</span>
          <select className="node-select" value={leftKey}
            onChange={(e) => update({ leftKey: e.target.value })}
            onClick={stopProp} onMouseDown={stopProp} disabled={!leftReady}
          >
            <option value="">— select —</option>
            {leftColumns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </div>

        <div className="node-body-row">
          <span className="node-label" style={{ color: '#34d399' }}>Right key</span>
          <select className="node-select" value={rightKey}
            onChange={(e) => update({ rightKey: e.target.value })}
            onClick={stopProp} onMouseDown={stopProp} disabled={!rightReady}
          >
            <option value="">— select —</option>
            {rightColumns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </div>
      </div>

      <div className="status-row">
        <div className={`status-dot ${isReady ? 'ready' : 'pending'}`} />
        <span className="status-text">
          {!leftReady || !rightReady
            ? 'Connect both inputs'
            : !leftKey || !rightKey
              ? 'Select join keys'
              : `${joinType} on ${leftKey} = ${rightKey}`}
        </span>
      </div>
    </div>
  )
}

const Memoized = memo(JoinNode)

// ── Node definition & registration ───────────────────────────────────────────
export const joinDef: NodeDef<JoinNodeData> = {
  type: 'join',
  category: 'operation',
  name: 'Join',
  desc: 'Merge two tables on a key',
  Icon: GitMerge,
  help: {
    summary: 'Combines two row streams into one using a SQL JOIN on matching key columns.',
    inputs: 'Two row streams: left table (top handle) and right table (bottom handle).',
    outputs: 'One merged row stream. Right-side column names are prefixed with "r_" to avoid collisions.',
    tips: [
      'INNER keeps only matching rows; LEFT keeps all left rows.',
      'Right-side columns appear as "r_colname" in downstream nodes.',
      'Click to preview the merged result before connecting further.',
    ],
  },
  inputPorts: [{ type: 'row' }, { type: 'row' }],
  outputPorts: [{ type: 'row' }],
  defaultData: () => ({ joinType: 'INNER', leftKey: '', rightKey: '', leftColumns: [], rightColumns: [] }),
  Component: Memoized,
}

registerNode(joinDef)

export default Memoized
