import { memo, useCallback, useState } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { GitMerge, Check, X } from 'lucide-react'
import type { AppNode, JoinNodeData, JoinColSelection } from '../lib/types'
import NodeHeader from './shared/NodeHeader'
import { registerNode, type NodeDef } from './registry'
import { PipelineNode } from './shared/PipelineNode'
import { rowHandle, colHandle, HEADER_ROW_OUT } from './shared/handles'
import { ColumnList } from './shared/columns'

// ── Component ─────────────────────────────────────────────────────────────────
type Props = NodeProps<AppNode & { data: JoinNodeData }>

const JOIN_TYPES = ['INNER', 'LEFT', 'RIGHT', 'FULL'] as const

function JoinNode({ id, data, selected }: Props) {
  const { setNodes } = useReactFlow()
  const { joinType, leftKey, rightKey, leftColumns = [], rightColumns = [], columnSelection = [] } = data
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const update = useCallback(
    (patch: Partial<JoinNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [id, setNodes]
  )
  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const leftReady  = leftColumns.length > 0
  const rightReady = rightColumns.length > 0
  const isReady    = leftReady && rightReady && !!leftKey && !!rightKey

  // Column selection helpers
  const includedCount = columnSelection.filter((s) => s.included).length
  const totalCount    = columnSelection.length

  const toggleCol = useCallback((side: 'left' | 'right', name: string) => {
    update({
      columnSelection: columnSelection.map((s) =>
        s.side === side && s.name === name ? { ...s, included: !s.included } : s
      )
    })
  }, [columnSelection, update])

  const setAlias = useCallback((side: 'left' | 'right', name: string, alias: string) => {
    update({
      columnSelection: columnSelection.map((s) =>
        s.side === side && s.name === name ? { ...s, alias } : s
      )
    })
  }, [columnSelection, update])

  const toggleAllSide = useCallback((side: 'left' | 'right', included: boolean) => {
    update({
      columnSelection: columnSelection.map((s) =>
        s.side === side ? { ...s, included } : s
      )
    })
  }, [columnSelection, update])

  // Subtitle
  const subtitle = (() => {
    if (!leftReady || !rightReady) return 'Connect two tables'
    if (totalCount > 0 && includedCount < totalCount) return `${includedCount}/${totalCount} cols · ${joinType}`
    return `${leftColumns.length + rightColumns.length} cols · ${joinType}`
  })()

  const leftSel  = columnSelection.filter((s) => s.side === 'left')
  const rightSel = columnSelection.filter((s) => s.side === 'right')
  const leftAllOn  = leftSel.length  > 0 && leftSel.every((s)  => s.included)
  const rightAllOn = rightSel.length > 0 && rightSel.every((s) => s.included)

  return (
    <PipelineNode selected={selected}>
      {/* Left input — top (left table) */}
      <Handle type="target" position={Position.Left} id="row-left"
        style={rowHandle(leftReady, { top: 42, left: -7 })}
      />
      {/* Left input — bottom (right table) */}
      <Handle type="target" position={Position.Left} id="row-right"
        style={rowHandle(rightReady, { top: 78, left: -7 })}
      />
      {/* Row output */}
      <Handle type="source" position={Position.Right} id="row-out"
        style={rowHandle(true, HEADER_ROW_OUT)}
      />

      <NodeHeader
        def={joinDef}
        id={id}
        subtitle={subtitle}
        advancedOpen={advancedOpen}
        onAdvancedToggle={() => setAdvancedOpen((v) => !v)}
      />

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

      {/* ── Advanced: column output selection ──────────────────────────────────── */}
      {advancedOpen && columnSelection.length > 0 && (
        <div className="join-col-panel nowheel nodrag" onMouseDown={stopProp}>

          {/* Left columns */}
          <JoinColGroup
            label="Left columns"
            labelColor="#60a5fa"
            cols={leftSel}
            allOn={leftAllOn}
            onToggleAll={(on) => toggleAllSide('left', on)}
            onToggle={(name) => toggleCol('left', name)}
            onAlias={(name, alias) => setAlias('left', name, alias)}
            stopProp={stopProp}
          />

          {/* Right columns */}
          <JoinColGroup
            label="Right columns"
            labelColor="#34d399"
            cols={rightSel}
            allOn={rightAllOn}
            onToggleAll={(on) => toggleAllSide('right', on)}
            onToggle={(name) => toggleCol('right', name)}
            onAlias={(name, alias) => setAlias('right', name, alias)}
            stopProp={stopProp}
          />
        </div>
      )}

      {advancedOpen && columnSelection.length === 0 && (
        <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-muted)' }}>
          Connect both inputs to configure columns.
        </div>
      )}

      {/* Column outputs — shown once both inputs are connected */}
      {(leftReady || rightReady) && (() => {
        const outCols = columnSelection.length > 0
          ? columnSelection.filter(s => s.included).map(s => ({
              name: s.alias || s.name,
              type: (s.side === 'left' ? leftColumns : rightColumns).find(c => c.name === s.name)?.type ?? 'TEXT',
            }))
          : [
              ...leftColumns,
              ...rightColumns.map(c => ({ name: `r_${c.name}`, type: c.type })),
            ]
        if (!outCols.length) return null
        return (
          <ColumnList columns={outCols} />
        )
      })()}

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
    </PipelineNode>
  )
}

// ── Column group sub-component ─────────────────────────────────────────────────
interface GroupProps {
  label: string
  labelColor: string
  cols: JoinColSelection[]
  allOn: boolean
  onToggleAll: (on: boolean) => void
  onToggle: (name: string) => void
  onAlias: (name: string, alias: string) => void
  stopProp: (e: React.MouseEvent) => void
}

function JoinColGroup({ label, labelColor, cols, allOn, onToggleAll, onToggle, onAlias, stopProp }: GroupProps) {
  if (!cols.length) return null
  return (
    <div className="join-col-group">
      {/* Group header */}
      <div className="join-col-group-hdr">
        <span style={{ color: labelColor, fontWeight: 700 }}>{label}</span>
        <button
          className="join-col-all-btn"
          onClick={(e) => { stopProp(e); onToggleAll(!allOn) }}
        >
          {allOn ? 'None' : 'All'}
        </button>
      </div>

      {/* Column rows — own scroll area so this group never hides the other one */}
      <div className="join-col-group-body">
        {cols.map((s) => (
          <div key={s.name} className={`join-col-row${s.included ? '' : ' excluded'}`}>
            {/* Toggle */}
            <button
              className={`join-col-toggle ${s.included ? 'on' : 'off'}`}
              onClick={(e) => { stopProp(e); onToggle(s.name) }}
              onMouseDown={(e) => e.stopPropagation()}
              title={s.included ? 'Exclude' : 'Include'}
            >
              {s.included
                ? <Check size={9} strokeWidth={2.5} />
                : <X     size={9} strokeWidth={2.5} />}
            </button>

            {/* Source name */}
            <span className="join-col-src" title={s.name}>{s.name}</span>

            {/* Arrow */}
            <span className="join-col-arrow">→</span>

            {/* Alias input */}
            <input
              className="join-col-alias"
              value={s.alias}
              placeholder={s.name}
              disabled={!s.included}
              onChange={(e) => onAlias(s.name, e.target.value)}
              onClick={stopProp}
              onMouseDown={(e) => e.stopPropagation()}
              title="Output column name"
            />
          </div>
        ))}
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
  hasAdvanced: true,
  help: {
    summary: 'Combines two row streams into one using a SQL JOIN on matching key columns. Use the advanced panel to choose exactly which columns to emit and rename them.',
    inputs: 'Two row streams: left table (top handle) and right table (bottom handle).',
    outputs: 'One merged row stream. By default right-side columns are prefixed with "r_". Use the ⚙ panel to rename or exclude any column.',
    tips: [
      'INNER keeps only matching rows; LEFT keeps all left rows (NULLs for unmatched right).',
      'Open ⚙ Advanced to exclude columns or rename them before they reach downstream nodes.',
      'Deselect the join-key columns on one side to avoid duplicate key columns in the output.',
    ],
  },
  inputPorts: [{ type: 'row' }, { type: 'row' }],
  outputPorts: [{ type: 'row' }],
  defaultData: () => ({ joinType: 'INNER', leftKey: '', rightKey: '', leftColumns: [], rightColumns: [] }),
  Component: Memoized,
}

registerNode(joinDef)

export default Memoized
