import { memo, useState, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { HardDrive, Play, Loader, CheckCircle, AlertCircle } from 'lucide-react'
import type { AppNode, AppEdge, MaterializeNodeData } from '../lib/types'
import { buildNodeSQL } from '../lib/sqlBuilder'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, colHandle, TOP_RIGHT_ROW_OUT } from './shared/handles'
import { ColumnList } from './shared/columns'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: MaterializeNodeData }>

function MaterializeNode({ id, data, selected }: Props) {
  const { getNodes, getEdges, setNodes } = useReactFlow()
  const { parquetPath, columns = [], rowCount, error } = data

  const [running, setRunning] = useState(false)

  const update = useCallback(
    (patch: Partial<MaterializeNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )

  const handleMaterialize = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    const nodes = getNodes() as AppNode[]
    const edges = getEdges() as AppEdge[]

    const inputEdge = edges.find((ed) => ed.target === id && ed.targetHandle === 'row-in')
    if (!inputEdge) {
      update({ status: 'error', error: 'Connect a data source first' })
      return
    }

    const sql = buildNodeSQL(inputEdge.source, nodes, edges, inputEdge.sourceHandle ?? undefined)
    if (!sql) {
      update({ status: 'error', error: 'No SQL from upstream node' })
      return
    }

    setRunning(true)
    update({ status: 'running', error: undefined })

    try {
      const result = await window.api.materializeRun(sql, parquetPath ?? undefined)

      // Count rows from the parquet
      const preview = await window.api.dbPreview(`SELECT COUNT(*) AS __cnt FROM read_parquet('${result.parquetPath.replace(/'/g, "''")}')`)
      const cnt = preview.rows[0]?.[0]

      update({
        parquetPath: result.parquetPath,
        columns: result.columns,
        status: 'done',
        rowCount: cnt != null ? Number(cnt) : null,
        error: undefined,
      })
    } catch (err) {
      update({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    } finally {
      setRunning(false)
    }
  }, [id, parquetPath, getNodes, getEdges, update])

  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const hasOutput = parquetPath !== null && columns.length > 0

  const subtitle = parquetPath
    ? `${rowCount != null ? rowCount.toLocaleString() + ' rows' : 'Materialized'}`
    : 'Not materialized'

  const btnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
    padding: '5px 10px', borderRadius: 6, cursor: running ? 'default' : 'pointer',
    fontSize: 11, fontWeight: 600, border: '1px solid',
    background: error  ? 'rgba(239,68,68,0.1)'
               : hasOutput ? 'rgba(34,197,94,0.1)'
               : 'rgba(99,102,241,0.12)',
    borderColor: error  ? 'var(--red)'
                : hasOutput ? 'var(--green-dark)'
                : '#4f46e5',
    color: error  ? 'var(--red)'
          : hasOutput ? 'var(--green)'
          : '#818cf8',
  }

  const BtnIcon = running ? Loader : error ? AlertCircle : hasOutput ? CheckCircle : Play
  const btnLabel = running ? 'Materializing…' : error ? 'Failed — retry?' : hasOutput ? 'Re-materialize' : 'Materialize'

  return (
    <PipelineNode selected={selected}>
      {/* Row input — left middle */}
      <Handle
        type="target"
        position={Position.Left}
        id="row-in"
        style={rowHandle(true, { top: '50%', left: -7 })}
      />

      {/* Row output — top-right corner */}
      <Handle
        type="source"
        position={Position.Right}
        id="row-out"
        style={rowHandle(hasOutput, TOP_RIGHT_ROW_OUT)}
      />

      <NodeHeader def={materializeDef} id={id} subtitle={subtitle} />

      <div className="node-body">
        <button
          style={btnStyle}
          onClick={handleMaterialize}
          onMouseDown={stopProp}
          disabled={running}
        >
          <BtnIcon size={12} strokeWidth={2.5} className={running ? 'spin' : undefined} />
          {btnLabel}
        </button>

        {error && (
          <div style={{ marginTop: 6, fontSize: 10, color: 'var(--red)', wordBreak: 'break-all' }}>
            {error}
          </div>
        )}
      </div>

      {/* Column list + per-column col-out handles (same as CSVInputNode) */}
      <ColumnList columns={columns} />
    </PipelineNode>
  )
}

const Memoized = memo(MaterializeNode)

// ── Node definition & registration ───────────────────────────────────────────
export const materializeDef: NodeDef<MaterializeNodeData> = {
  type: 'materialize',
  category: 'operation',
  name: 'Materialize',
  desc: 'Write to Parquet, restart query',
  Icon: HardDrive,
  help: {
    summary: 'Executes the upstream pipeline and saves its output to a temporary Parquet file. Downstream nodes read from that file, breaking the query chain and acting as a fresh data source.',
    inputs: 'Row stream (blue square).',
    outputs: 'Row stream and one column handle per materialized column.',
    tips: [
      'Use this to cache an expensive join or aggregate so downstream branches don\'t re-run it.',
      'Click Re-materialize to refresh the snapshot with the latest upstream data.',
      'The Parquet file lives in your system temp folder and is replaced each time you materialize.',
    ],
  },
  inputPorts:  [{ type: 'row' }],
  outputPorts: [{ type: 'row' }, { type: 'col' }],
  defaultData: () => ({ parquetPath: null, columns: [], status: 'idle', rowCount: null }),
  Component: Memoized,
}

registerNode(materializeDef)

export default Memoized
