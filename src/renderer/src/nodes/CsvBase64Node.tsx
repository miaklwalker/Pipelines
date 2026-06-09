import { memo, useCallback, useState } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { FileCode2, FolderOpen, RefreshCw } from 'lucide-react'
import type { AppNode, CsvBase64Data } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { colHandle, HEADER_ROW_TOP } from './shared/handles'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: CsvBase64Data }>

function CsvBase64Node({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const { fileName = '', filePath = '', base64 = '', columnName = 'file_data', hasAnchor = false } = data
  const [loading, setLoading] = useState(false)

  const update = useCallback(
    (patch: Partial<CsvBase64Data>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const pickFile = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    setLoading(true)
    try {
      const result = await window.api.selectFileBase64([
        { name: 'CSV Files', extensions: ['csv', 'tsv', 'txt'] },
        { name: 'All Files', extensions: ['*'] },
      ])
      if (result) update({ fileName: result.fileName, filePath: result.filePath, base64: result.base64 })
    } finally {
      setLoading(false)
    }
  }, [update])

  const reEncode = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!filePath) return
    setLoading(true)
    try {
      const result = await window.api.selectFileBase64()
      if (result) update({ fileName: result.fileName, filePath: result.filePath, base64: result.base64 })
    } finally {
      setLoading(false)
    }
  }, [filePath, update])

  const isReady  = !!(columnName && base64)
  const sizeKb   = base64 ? Math.round((base64.length * 3 / 4) / 1024) : 0
  const subtitle = isReady
    ? `${fileName} · ${sizeKb.toLocaleString()} KB`
    : 'No file loaded'

  return (
    <PipelineNode selected={selected}>
      {/* Anchor input — amber square */}
      <Handle type="target" position={Position.Left} id="anchor-in"
        style={{
          top: HEADER_ROW_TOP, left: -7, width: 11, height: 11, borderRadius: 2,
          background: hasAnchor ? '#f59e0b' : '#44403c',
          border: `2px solid ${hasAnchor ? '#d97706' : '#292524'}`,
        }}
      />

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

        <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
          <button
            onClick={pickFile}
            onMouseDown={stopProp}
            disabled={loading}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              padding: '5px 8px', borderRadius: 5, fontSize: 10.5, fontWeight: 600, cursor: loading ? 'default' : 'pointer',
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
              disabled={loading}
              title="Re-read file from disk"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '5px 8px', borderRadius: 5, fontSize: 10.5, cursor: loading ? 'default' : 'pointer',
                background: 'rgba(99,102,241,0.1)', border: '1px solid #6366f1', color: '#818cf8',
              }}
            >
              <RefreshCw size={11} strokeWidth={2.5} />
            </button>
          )}
        </div>

        {base64 && (
          <div style={{
            marginTop: 5, padding: '4px 7px', borderRadius: 4, fontSize: 9.5,
            fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
            background: 'rgba(255,255,255,0.04)', wordBreak: 'break-all', maxHeight: 36, overflow: 'hidden',
          }}>
            {base64.slice(0, 80)}…
          </div>
        )}
      </div>

      {/* Port legend */}
      <div className="emitter-legend">
        <span className="emitter-legend-item">
          <span className="emitter-dot emitter-dot-anchor" />
          anchor
        </span>
        <span className="emitter-legend-item emitter-legend-right">
          col out
          <span className="emitter-dot emitter-dot-col" />
        </span>
      </div>

      <div className="status-row">
        <div className={`status-dot ${isReady ? 'ready' : 'pending'}`} />
        <span className="status-text">
          {!columnName ? 'Set a column name'
            : !base64 ? 'Select a file to encode'
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
  desc: 'Encode a file as a base64 string column',
  Icon: FileCode2,
  help: {
    summary: 'Reads a file from disk (CSV, TSV, or any file) and emits its contents as a base64-encoded string. Use this to upload a file via an API node.',
    inputs: 'Anchor (amber square) — a row stream that sets the row count context.',
    outputs: 'One column output (green circle) emitting the base64 string. Wire to a Destination col-in or use in a POST/PUT body.',
    tips: [
      'Wire col-out to a Build JSON node to embed the base64 string inside a larger request body.',
      'Use the refresh button (↻) to re-read the file from disk without changing the path.',
      'The base64 value is the same for every row — anchor to a 1-row source for a single upload.',
      'Supports any file format, not just CSV.',
    ],
  },
  inputPorts:  [],
  outputPorts: [{ type: 'col' }],
  defaultData: () => ({ fileName: '', filePath: '', base64: '', columnName: 'file_data', hasAnchor: false }),
  Component: Memoized,
}

registerNode(csvBase64Def)

export default Memoized
