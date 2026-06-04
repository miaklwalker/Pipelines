import { memo, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { BarChart3, Loader } from 'lucide-react'
import type { AppNode, AppEdge, ReportNodeData } from '../lib/types'
import { buildNodeSQL, getNodeOutputColumns } from '../lib/sqlBuilder'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, TOP_RIGHT_ROW_OUT } from './shared/handles'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: ReportNodeData }>

const INLINE_COL_CAP = 8

function fillPct(nonNull: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((nonNull / total) * 100)
}

function ReportNode({ id, data, selected }: Props) {
  const { getNodes, getEdges, setNodes } = useReactFlow()
  const { inputColumns = [], result = null, status = 'idle', error } = data

  const update = useCallback(
    (patch: Partial<ReportNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const runProfile = useCallback(async () => {
    const nodes = getNodes() as AppNode[]
    const edges = getEdges() as AppEdge[]
    const sql = buildNodeSQL(id, nodes, edges)
    if (!sql) {
      update({ status: 'error', error: 'Connect a row input first.' })
      return
    }
    const cols = getNodeOutputColumns(id, nodes, edges)
    update({ status: 'running', error: undefined })
    try {
      const profile = await window.api.dbProfile(sql, cols)
      update({ result: profile, status: 'done', error: undefined })
    } catch (err) {
      update({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  }, [getNodes, getEdges, id, update])

  const connected = inputColumns.length > 0
  const subtitle = result
    ? `${result.rowCount.toLocaleString()} rows · ${result.columns.length} cols`
    : connected
      ? `${inputColumns.length} cols · not profiled`
      : 'Connect a row input'

  const inlineCols = result?.columns.slice(0, INLINE_COL_CAP) ?? []
  const moreCount = result ? Math.max(0, result.columns.length - INLINE_COL_CAP) : 0

  return (
    <PipelineNode selected={selected}>
      <Handle type="target" position={Position.Left} id="row-in"
        style={rowHandle(connected, { top: '50%', left: -7 })}
      />
      <Handle type="source" position={Position.Right} id="row-out"
        style={rowHandle(connected, TOP_RIGHT_ROW_OUT)}
      />

      <NodeHeader def={reportDef} id={id} subtitle={subtitle} />

      <div className="node-body">
        <button
          className="report-profile-btn"
          onClick={(e) => { stopProp(e); runProfile() }}
          onMouseDown={stopProp}
          disabled={status === 'running' || !connected}
        >
          {status === 'running'
            ? <><Loader size={11} strokeWidth={2} className="spin" /> Profiling…</>
            : result ? 'Re-profile' : 'Profile'}
        </button>
      </div>

      {status === 'error' && error && (
        <div className="report-error nowheel nodrag">{error}</div>
      )}

      {result && (
        <div className="report-summary nowheel nodrag">
          {inlineCols.map((c) => {
            const pct = fillPct(c.nonNull, result.rowCount)
            return (
              <div key={c.name} className="report-bar-row" title={`${c.name}: ${c.nonNull.toLocaleString()} / ${result.rowCount.toLocaleString()} filled · ${c.distinct.toLocaleString()} distinct`}>
                <span className="report-bar-name">{c.name}</span>
                <span className="report-bar-track">
                  <span
                    className={`report-bar-fill${pct < 100 ? ' partial' : ''}${pct === 0 ? ' empty' : ''}`}
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="report-bar-pct">{pct}%</span>
              </div>
            )
          })}
          {moreCount > 0 && (
            <div className="report-more">+{moreCount} more — click node for full report</div>
          )}
        </div>
      )}

      <div className="status-row">
        <div className={`status-dot ${result ? 'ready' : 'pending'}`} />
        <span className="status-text">
          {result ? 'Click node for full report' : connected ? 'Ready to profile' : 'Awaiting input'}
        </span>
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(ReportNode)

// ── Node definition & registration ───────────────────────────────────────────
export const reportDef: NodeDef<ReportNodeData> = {
  type: 'report',
  category: 'operation',
  name: 'Report',
  desc: 'Profile a dataset — fill rate, distinct, top values',
  Icon: BarChart3,
  help: {
    summary: 'A pass-through tap that profiles the incoming rows: per-column fill rate (how many rows have a value), distinct count, min/max, and the most common values. The row stream passes through unchanged so you can keep building downstream.',
    inputs: 'Row stream (blue square).',
    outputs: 'The same row stream, unchanged — wire it onward if you like.',
    tips: [
      'Click "Profile" to compute stats, or click the node body to open the full report drawer.',
      'Fill rate = non-null rows ÷ total rows. A short bar means lots of missing values.',
      'Drop one in mid-pipeline to sanity-check data quality without altering it.',
    ],
  },
  inputPorts:  [{ type: 'row' }],
  outputPorts: [{ type: 'row' }],
  defaultData: () => ({ inputColumns: [], result: null, status: 'idle' }),
  Component: Memoized,
}

registerNode(reportDef)

export default Memoized
