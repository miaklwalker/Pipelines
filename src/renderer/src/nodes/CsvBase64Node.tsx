import { memo, useCallback, useState } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { FileCode2, FolderOpen, RefreshCw, Loader, CheckCircle, AlertCircle, Zap } from 'lucide-react'
import type { AppNode, AppEdge, CsvBase64Data } from '../lib/types'
import { buildNodeSQL } from '../lib/sqlBuilder'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, colHandle, HEADER_ROW_IN, HEADER_ROW_TOP } from './shared/handles'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: CsvBase64Data }>

function CsvBase64Node({ id, data, selected }: Props) {
  const { getNodes, getEdges, setNodes } = useReactFlow()
  const {
    columnName = 'file_data',
    base64 = '',
    fileName = '',
    filePath = '',
    hasAnchor = false,
    hasRowIn = false,
    rowCount,
    encodeStatus = 'idle',
    encodeError,
  } = data

  const [fileBusy, setFileBusy] = useState(false)

  const update = useCallback(
    (patch: Partial<CsvBase64Data>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  // ── File mode ────────────────────────────────────────────────────────────────
  const pickFile = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    setFileBusy(true)
    try {
      const result = await window.api.selectFileBase64([
        { name: 'CSV Files', extensions: ['csv', 'tsv', 'txt'] },
        { name: 'All Files', extensions: ['*'] },
      ])
      if (result) update({ fileName: result.fileName, filePath: result.filePath, base64: result.base64, encodeStatus: 'done', encodeError: undefined, rowCount: undefined })
    } finally {
      setFileBusy(false)
    }
  }, [update])

  const reEncode = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!filePath) return
    setFileBusy(true)
    try {
      const result = await window.api.selectFileBase64()
      if (result) update({ fileName: result.fileName, filePath: result.filePath, base64: result.base64, encodeStatus: 'done', encodeError: undefined, rowCount: undefined })
    } finally {
      setFileBusy(false)
    }
  }, [filePath, update])

  // ── Row mode ─────────────────────────────────────────────────────────────────
  const encodeRows = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    update({ encodeStatus: 'encoding', encodeError: undefined })
    try {
      const nodes  = getNodes() as AppNode[]
      const edges  = getEdges() as AppEdge[]
      const rowEdge = edges.find((ed) => ed.target === id && ed.targetHandle === 'row-in')
      if (!rowEdge) throw new Error('No row input connected')
      const sql = buildNodeSQL(rowEdge.source, nodes, edges, rowEdge.sourceHandle ?? undefined)
      if (!sql) throw new Error('Could not build SQL for the connected source')
      const result = await window.api.rowsToBase64(sql)
      update({ base64: result.base64, rowCount: result.rowCount, fileName: `${result.rowCount.toLocaleString()} rows`, filePath: '', encodeStatus: 'done', encodeError: undefined })
    } catch (err) {
      update({ encodeStatus: 'error', encodeError: err instanceof Error ? err.message : String(err) })
    }
  }, [id, getNodes, getEdges, update])

  // ── Derived display ───────────────────────────────────────────────────────────
  const sizeKb   = base64 ? Math.round((base64.length * 3 / 4) / 1024) : 0
  const isReady  = !!(columnName && base64)
  const subtitle = isReady
    ? hasRowIn
      ? `${rowCount?.toLocaleString() ?? '?'} rows · ${sizeKb.toLocaleString()} KB`
      : `${fileName} · ${sizeKb.toLocaleString()} KB`
    : hasRowIn ? 'Click Encode to run' : 'No file loaded'

  const isEncoding = encodeStatus === 'encoding' || fileBusy
  const EncodeIcon = isEncoding ? Loader : encodeStatus === 'error' ? AlertCircle : encodeStatus === 'done' ? CheckCircle : Zap
  const encodeLabel = isEncoding ? 'Encoding…' : encodeStatus === 'error' ? 'Failed — retry' : encodeStatus === 'done' ? 'Re-encode' : 'Encode rows'
  const encodeColor = encodeStatus === 'error' ? 'var(--red)' : encodeStatus === 'done' ? 'var(--green)' : '#818cf8'
  const encodeBg    = encodeStatus === 'error' ? 'rgba(239,68,68,0.1)' : encodeStatus === 'done' ? 'rgba(34,197,94,0.1)' : 'rgba(99,102,241,0.1)'
  const encodeBorder = encodeStatus === 'error' ? 'var(--red)' : encodeStatus === 'done' ? 'var(--green-dark)' : '#6366f1'

  return (
    <PipelineNode selected={selected}>
      {/* Row input — blue square (row mode) */}
      <Handle type="target" position={Position.Left} id="row-in"
        style={rowHandle(hasRowIn, HEADER_ROW_IN)}
      />

      {/* Anchor input — amber square (file mode, sits below row-in) */}
      {!hasRowIn && (
        <Handle type="target" position={Position.Left} id="anchor-in"
          style={{
            top: HEADER_ROW_TOP, left: -7, width: 11, height: 11, borderRadius: 2,
            background: hasAnchor ? '#f59e0b' : '#44403c',
            border: `2px solid ${hasAnchor ? '#d97706' : '#292524'}`,
          }}
        />
      )}

      {/* Column output — green circle */}
      <Handle type="source" position={Position.Right} id="col-out"
        style={colHandle({ top: '50%', right: -5.5, width: 11, height: 11 })}
      />

      <NodeHeader def={csvBase64Def} id={id} subtitle={subtitle} />

      <div className="node-body">
        <div className="node-body-row">
          <span className="node-label">Column</span>
          <input
            className="node-input"
            placeholder="col_name"
            value={columnName}
            onChange={(e) => update({ columnName: e.target.value })}
            onClick={stopProp} onMouseDown={stopProp}
          />
        </div>

        {/* ── Row mode: encode button ── */}
        {hasRowIn && (
          <>
            <button
              onClick={encodeRows}
              onMouseDown={stopProp}
              disabled={isEncoding}
              style={{
                marginTop: 6, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                padding: '5px 8px', borderRadius: 5, fontSize: 10.5, fontWeight: 600, cursor: isEncoding ? 'default' : 'pointer',
                background: encodeBg, border: `1px solid ${encodeBorder}`, color: encodeColor,
              }}
            >
              <EncodeIcon size={11} strokeWidth={2.5} className={isEncoding ? 'spin' : undefined} />
              {encodeLabel}
            </button>
            {encodeError && (
              <div style={{ marginTop: 4, fontSize: 9.5, color: 'var(--red)', wordBreak: 'break-all' }}>
                {encodeError}
              </div>
            )}
          </>
        )}

        {/* ── File mode: picker buttons ── */}
        {!hasRowIn && (
          <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
            <button
              onClick={pickFile}
              onMouseDown={stopProp}
              disabled={fileBusy}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                padding: '5px 8px', borderRadius: 5, fontSize: 10.5, fontWeight: 600, cursor: fileBusy ? 'default' : 'pointer',
                background: base64 ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                border: `1px solid ${base64 ? 'var(--green-dark)' : '#d97706'}`,
                color: base64 ? 'var(--green)' : '#f59e0b',
              }}
            >
              <FolderOpen size={11} strokeWidth={2.5} />
              {base64 ? 'Change file' : 'Select file'}
            </button>

            {base64 && (
              <button
                onClick={reEncode}
                onMouseDown={stopProp}
                disabled={fileBusy}
                title="Re-read file from disk"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '5px 8px', borderRadius: 5, fontSize: 10.5, cursor: fileBusy ? 'default' : 'pointer',
                  background: 'rgba(99,102,241,0.1)', border: '1px solid #6366f1', color: '#818cf8',
                }}
              >
                <RefreshCw size={11} strokeWidth={2.5} />
              </button>
            )}
          </div>
        )}

        {/* Base64 preview — shown in both modes once encoded */}
        {base64 && (
          <div style={{
            marginTop: 5, padding: '4px 7px', borderRadius: 4, fontSize: 9.5,
            fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
            background: 'rgba(255,255,255,0.04)', wordBreak: 'break-all', maxHeight: 34, overflow: 'hidden',
          }}>
            {base64.slice(0, 80)}…
          </div>
        )}
      </div>

      {/* Port legend */}
      <div className="emitter-legend">
        {hasRowIn ? (
          <span className="emitter-legend-item">
            <span className="emitter-dot" style={{ background: '#3b82f6', borderRadius: 2, width: 8, height: 8, display: 'inline-block' }} />
            row in
          </span>
        ) : (
          <span className="emitter-legend-item">
            <span className="emitter-dot emitter-dot-anchor" />
            anchor
          </span>
        )}
        <span className="emitter-legend-item emitter-legend-right">
          col out
          <span className="emitter-dot emitter-dot-col" />
        </span>
      </div>

      <div className="status-row">
        <div className={`status-dot ${isReady ? 'ready' : 'pending'}`} />
        <span className="status-text">
          {!columnName ? 'Set a column name'
            : hasRowIn && !base64 ? 'Connect row-in then click Encode'
            : !base64 ? 'Select a file to encode'
            : hasRowIn
              ? `${rowCount?.toLocaleString() ?? '?'} rows → base64 (${sizeKb.toLocaleString()} KB)`
              : `${fileName} → base64 (${sizeKb.toLocaleString()} KB)`}
        </span>
      </div>
    </PipelineNode>
  )
}

const Memoized = memo(CsvBase64Node)

// ── Node definition & registration ───────────────────────────────────────────
export const csvBase64Def: NodeDef<CsvBase64Data> = {
  type: 'csv-base64',
  category: 'emitter',
  name: 'File → Base64',
  desc: 'Encode a file or row stream as base64',
  Icon: FileCode2,
  help: {
    summary: 'Encodes data as a base64 string for use in API uploads. Two modes: pick a file from disk, or wire a row stream to encode the upstream rows as a CSV string.',
    inputs: 'Row stream (blue square) — when wired, clicking Encode runs the upstream query and encodes all rows as CSV. Anchor (amber square, file mode only) — drives the col-out row count.',
    outputs: 'One column output (green circle) emitting the base64 string. Wire to a Build JSON node or directly to an API body field.',
    tips: [
      'File mode: pick any file (CSV, TSV, etc.) and the contents are encoded immediately.',
      'Row mode: wire any row stream to row-in then click Encode — the current data snapshot is captured.',
      'Re-encode (row mode) any time the upstream data changes.',
      'Wire col-out → Build JSON to embed the base64 string inside a larger request body.',
      'For a single-upload API call, anchor the col-out to a 1-row Static Value source.',
    ],
  },
  inputPorts:  [{ type: 'row' }],
  outputPorts: [{ type: 'col' }],
  defaultData: () => ({
    columnName: 'file_data', base64: '', fileName: '', filePath: '',
    hasAnchor: false, hasRowIn: false, rowCount: undefined,
    encodeStatus: 'idle', encodeError: undefined,
  }),
  Component: Memoized,
}

registerNode(csvBase64Def)

export default Memoized
