import { memo, useState, useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { FileDown, Download, Loader, CheckCircle, AlertCircle } from 'lucide-react'
import type { AppNode, AppEdge, CSVOutputNodeData } from '../lib/types'
import { buildNodeSQL } from '../lib/sqlBuilder'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: CSVOutputNodeData }>

type ExportStatus = 'idle' | 'running' | 'done' | 'error'

const DELIMITER_OPTIONS = [
  { value: 'comma',     label: 'Comma  ,',    char: ',' },
  { value: 'semicolon', label: 'Semicolon ;', char: ';' },
  { value: 'pipe',      label: 'Pipe  |',     char: '|' },
  { value: 'tab',       label: 'Tab  \\t',    char: '\t' },
] as const

type DelimiterKey = (typeof DELIMITER_OPTIONS)[number]['value']

function CSVOutputNode({ id, data, selected }: Props) {
  const { getNodes, getEdges, setNodes } = useReactFlow()
  const { outputPath, includeHeader = true, inputColumns = [], lastExport, delimiter = 'comma' } = data

  const [status,   setStatus]   = useState<ExportStatus>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [advOpen,  setAdvOpen]  = useState(false)

  const hasInput = inputColumns.length > 0

  const update = useCallback(
    (patch: Partial<CSVOutputNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )

  const handleExport = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    const nodes = getNodes() as AppNode[]
    const edges = getEdges() as AppEdge[]
    const sql   = buildNodeSQL(id, nodes, edges)

    if (!sql) { setErrorMsg('Connect a data source first'); setStatus('error'); return }

    setStatus('running')
    setErrorMsg('')

    try {
      const delimChar = DELIMITER_OPTIONS.find((d) => d.value === delimiter)?.char ?? ','
      const result = await window.api.exportCSV(sql, delimChar)
      if (!result) { setStatus('idle'); return }
      update({
        outputPath: result.filePath,
        lastExport: { rowCount: result.rowCount, timestamp: new Date().toLocaleTimeString() },
      })
      setStatus('done')
      setTimeout(() => setStatus('idle'), 4000)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }, [id, delimiter, getNodes, getEdges, update])

  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const subtitle = outputPath
    ? outputPath.split('/').pop()!
    : hasInput ? 'Ready to export' : 'No input connected'

  // Status-driven export button appearance
  const btnStyle = {
    background: status === 'done'  ? 'rgba(34,197,94,0.15)'
               : status === 'error' ? 'rgba(239,68,68,0.1)'
               : 'rgba(59,130,246,0.12)',
    borderColor: status === 'done'  ? 'var(--green-dark)'
                : status === 'error' ? 'var(--red)'
                : 'var(--blue-dark)',
    color: status === 'done'  ? 'var(--green)'
          : status === 'error' ? 'var(--red)'
          : 'var(--blue)',
  }

  const BtnIcon =
    status === 'running' ? Loader :
    status === 'done'    ? CheckCircle :
    status === 'error'   ? AlertCircle :
    Download

  const btnLabel =
    status === 'running' ? 'Exporting…'    :
    status === 'done'    ? 'Export complete' :
    status === 'error'   ? 'Export failed'  :
    'Export to CSV'

  return (
    <div className={`pipeline-node${selected ? ' selected' : ''}`} title="Click to preview">
      <Handle type="target" position={Position.Left} id="row-in"
        style={{
          top: '50%', left: -7, width: 13, height: 13, borderRadius: 3,
          background: hasInput ? 'var(--row-handle)' : '#334155',
          border: `2px solid ${hasInput ? 'var(--blue-dark)' : '#1e293b'}`,
        }}
      />

      <NodeHeader
        def={csvOutputDef}
        subtitle={subtitle}
        advancedOpen={advOpen}
        onAdvancedToggle={() => setAdvOpen((v) => !v)}
      />

      <div className="node-body">
        <div className="node-body-row">
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11.5, color: 'var(--text-dim)' }}
            onClick={stopProp} onMouseDown={stopProp}
          >
            <input
              type="checkbox"
              checked={includeHeader}
              onChange={() => update({ includeHeader: !includeHeader })}
              style={{ cursor: 'pointer', accentColor: 'var(--blue)' }}
            />
            Include header row
          </label>
        </div>

        {/* Advanced panel */}
        {advOpen && (
          <div className="advanced-panel">
            <div className="node-body-row">
              <span className="node-label">Delimiter</span>
              <select
                className="node-select"
                value={delimiter as string}
                onChange={(e) => update({ delimiter: e.target.value as DelimiterKey })}
                onClick={stopProp} onMouseDown={stopProp}
              >
                {DELIMITER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        <button
          className="export-btn"
          onClick={handleExport}
          onMouseDown={stopProp}
          disabled={status === 'running' || !hasInput}
          style={btnStyle}
        >
          <BtnIcon
            size={12}
            strokeWidth={status === 'running' ? 2 : 1.75}
            className={status === 'running' ? 'spin' : undefined}
            style={{ display: 'inline', verticalAlign: 'middle', marginRight: 5 }}
          />
          {btnLabel}
        </button>

        {status === 'error' && errorMsg && (
          <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 4, wordBreak: 'break-all', fontFamily: 'var(--font-mono)' }}>
            {errorMsg}
          </div>
        )}

        {lastExport && status !== 'error' && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            Last: {lastExport.rowCount != null ? `${Number(lastExport.rowCount).toLocaleString()} rows` : 'complete'} at {lastExport.timestamp}
          </div>
        )}
      </div>

      <div className="status-row">
        <div className={`status-dot ${hasInput ? 'ready' : 'pending'}`} />
        <span className="status-text">
          {!hasInput ? 'Connect a data source' : `${inputColumns.length} columns in`}
        </span>
      </div>
    </div>
  )
}

const Memoized = memo(CSVOutputNode)

// ── Node definition & registration ───────────────────────────────────────────
export const csvOutputDef: NodeDef<CSVOutputNodeData> = {
  type: 'csv-output',
  category: 'output',
  name: 'CSV Export',
  desc: 'Write result to a CSV file',
  Icon: FileDown,
  help: {
    summary: 'Runs the full pipeline query and exports the result to a CSV file using DuckDB COPY.',
    inputs: 'One row stream.',
    outputs: 'None — this is a sink node.',
    tips: [
      'Click "Export to CSV" to open a save dialog and choose the output location.',
      'Use the gear icon to change the delimiter (comma, semicolon, pipe, tab).',
      'The header row is always written unless you uncheck "Include header row".',
      'Click the node body to preview the data before exporting.',
    ],
  },
  inputPorts: [{ type: 'row' }],
  outputPorts: [],
  defaultData: () => ({ outputPath: '', includeHeader: true, inputColumns: [], lastExport: null, delimiter: 'comma' }),
  hasAdvanced: true,
  Component: Memoized,
}

registerNode(csvOutputDef)

export default Memoized
