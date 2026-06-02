/**
 * Pure graph-traversal utilities shared between App.tsx and node components.
 * Nothing here imports React or React Flow — just data manipulation.
 */
import { getNodeOutputColumns } from './sqlBuilder'
import type {
  AppNode, AppEdge,
  JoinNodeData, JoinColSelection, DestinationNodeData,
  ConnectionNodeData, ReadTableNodeData, ReadTableCachedNodeData,
} from './types'

// ── Column propagation ────────────────────────────────────────────────────────

export function propagateColumns(nodes: AppNode[], edges: AppEdge[]): AppNode[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (nodes.map((node) => {
    // ── Join ──────────────────────────────────────────────────────────────────
    if (node.type === 'join') {
      const leftEdge  = edges.find((e) => e.target === node.id && e.targetHandle === 'row-left')
      const rightEdge = edges.find((e) => e.target === node.id && e.targetHandle === 'row-right')
      const leftCols  = leftEdge  ? getNodeOutputColumns(leftEdge.source,  nodes, edges) : []
      const rightCols = rightEdge ? getNodeOutputColumns(rightEdge.source, nodes, edges) : []
      const d = node.data as JoinNodeData
      const leftKey  = leftCols.find((c) => c.name === d.leftKey)  ? d.leftKey  : ''
      const rightKey = rightCols.find((c) => c.name === d.rightKey) ? d.rightKey : ''

      // Rebuild columnSelection, merging in any existing user choices
      const existing = d.columnSelection ?? []
      const leftSel: JoinColSelection[] = leftCols.map((c) =>
        existing.find((s) => s.side === 'left'  && s.name === c.name)
          ?? { side: 'left',  name: c.name, alias: c.name,         included: true }
      )
      const rightSel: JoinColSelection[] = rightCols.map((c) =>
        existing.find((s) => s.side === 'right' && s.name === c.name)
          ?? { side: 'right', name: c.name, alias: `r_${c.name}`,  included: true }
      )
      const columnSelection = [...leftSel, ...rightSel]

      return { ...node, data: { ...d, leftColumns: leftCols, rightColumns: rightCols, leftKey, rightKey, columnSelection } }
    }

    // ── Single row-in nodes ───────────────────────────────────────────────────
    if (node.type === 'transform' || node.type === 'csv-output' || node.type === 'filter'
      || node.type === 'unique' || node.type === 'sort' || node.type === 'aggregate') {
      const inputEdge = edges.find((e) => e.target === node.id && e.targetHandle === 'row-in')
      const inputCols = inputEdge ? getNodeOutputColumns(inputEdge.source, nodes, edges) : []
      return { ...node, data: { ...node.data, inputColumns: inputCols } }
    }

    // ── Destination ───────────────────────────────────────────────────────────
    if (node.type === 'destination') {
      const inputEdge = edges.find((e) => e.target === node.id && e.targetHandle === 'row-in')
      const inputCols = inputEdge ? getNodeOutputColumns(inputEdge.source, nodes, edges) : []
      const d = node.data as DestinationNodeData
      const existingMap = d.colMap ?? []
      // Custom columns the user created (sourceCol === '') — always preserved
      const customCols = existingMap.filter((m) => !m.sourceCol)
      // Upstream pass-through columns: respect user's drag order from existingMap,
      // then append any new upstream columns not yet in existingMap
      const inputColNames = new Set(inputCols.map((c) => c.name))
      const orderedPassThrough = existingMap
        .filter((m) => m.sourceCol && inputColNames.has(m.sourceCol))
      const existingSourceCols = new Set(orderedPassThrough.map((m) => m.sourceCol))
      const newCols = inputCols
        .filter((col) => !existingSourceCols.has(col.name))
        .map((col) => ({ sourceCol: col.name, destCol: col.name, included: true }))
      const connEdge = edges.find((e) => e.target === node.id && e.targetHandle === 'conn-in')
      let resolvedConfig: import('./types').PgConfig | null = null
      if (connEdge) {
        const connNode = nodes.find((n) => n.id === connEdge.source && n.type === 'connection')
        if (connNode) resolvedConfig = (connNode.data as ConnectionNodeData).config
      }
      return { ...node, data: { ...d, inputColumns: inputCols, colMap: [...orderedPassThrough, ...newCols, ...customCols], resolvedConfig } }
    }

    // ── Merge ─────────────────────────────────────────────────────────────────
    if (node.type === 'merge') {
      const leftEdge  = edges.find((e) => e.target === node.id && e.targetHandle === 'row-left')
      const rightEdge = edges.find((e) => e.target === node.id && e.targetHandle === 'row-right')
      const srcEdge   = leftEdge ?? rightEdge
      const inputCols = srcEdge ? getNodeOutputColumns(srcEdge.source, nodes, edges) : []
      return { ...node, data: { ...node.data, inputColumns: inputCols } }
    }

    // ── Emitters ──────────────────────────────────────────────────────────────
    if (node.type === 'static-value' || node.type === 'increment-value'
      || node.type === 'map-value' || node.type === 'conditional-output') {
      const hasAnchor = edges.some((e) => e.target === node.id && e.targetHandle === 'anchor-in')
      return { ...node, data: { ...node.data, hasAnchor } }
    }

    // ── Write-table: resolvedConfig from ConnectionNode + inputColumns from row-in ─
    if (node.type === 'write-table') {
      const connEdge  = edges.find((e) => e.target === node.id && e.targetHandle === 'conn-in')
      const inputEdge = edges.find((e) => e.target === node.id && e.targetHandle === 'row-in')
      const inputCols = inputEdge ? getNodeOutputColumns(inputEdge.source, nodes, edges) : []
      if (connEdge) {
        const connNode = nodes.find((n) => n.id === connEdge.source && n.type === 'connection')
        if (connNode) {
          const { config } = connNode.data as ConnectionNodeData
          return { ...node, data: { ...node.data, resolvedConfig: config, inputColumns: inputCols } }
        }
      }
      return { ...node, data: { ...node.data, resolvedConfig: null, inputColumns: inputCols } }
    }

    // ── DB read/browse nodes — copy resolved PG config from ConnectionNode ──────
    if (node.type === 'read-table' || node.type === 'read-table-cached' || node.type === 'browse-schema') {
      const connEdge = edges.find((e) => e.target === node.id && e.targetHandle === 'conn-in')
      if (connEdge) {
        const connNode = nodes.find((n) => n.id === connEdge.source && n.type === 'connection')
        if (connNode) {
          const { config } = connNode.data as ConnectionNodeData
          return { ...node, data: { ...node.data, resolvedConfig: config } }
        }
      }
      return { ...node, data: { ...node.data, resolvedConfig: null } }
    }

    return node
  }) as AppNode[])
}
