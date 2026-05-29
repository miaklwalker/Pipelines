/**
 * Pure graph-traversal utilities shared between App.tsx and node components.
 * Nothing here imports React or React Flow — just data manipulation.
 */
import { getNodeOutputColumns } from './sqlBuilder'
import type {
  AppNode, AppEdge,
  JoinNodeData, DestinationNodeData,
  ConnectionNodeData, ReadTableNodeData, ReadTableCachedNodeData,
} from './types'

// ── Column propagation ────────────────────────────────────────────────────────

export function propagateColumns(nodes: AppNode[], edges: AppEdge[]): AppNode[] {
  return nodes.map((node) => {
    // ── Join ──────────────────────────────────────────────────────────────────
    if (node.type === 'join') {
      const leftEdge  = edges.find((e) => e.target === node.id && e.targetHandle === 'row-left')
      const rightEdge = edges.find((e) => e.target === node.id && e.targetHandle === 'row-right')
      const leftCols  = leftEdge  ? getNodeOutputColumns(leftEdge.source,  nodes, edges) : []
      const rightCols = rightEdge ? getNodeOutputColumns(rightEdge.source, nodes, edges) : []
      const d = node.data as JoinNodeData
      const leftKey  = leftCols.find((c)  => c.name === d.leftKey)  ? d.leftKey  : ''
      const rightKey = rightCols.find((c) => c.name === d.rightKey) ? d.rightKey : ''
      return { ...node, data: { ...d, leftColumns: leftCols, rightColumns: rightCols, leftKey, rightKey } }
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
      const colMap = inputCols.map((col) => {
        const existing = existingMap.find((m) => m.sourceCol === col.name)
        return existing ?? { sourceCol: col.name, destCol: col.name, included: true }
      })
      return { ...node, data: { ...d, inputColumns: inputCols, colMap } }
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

    // ── DB read nodes — copy resolved PG config from connected ConnectionNode ──
    if (node.type === 'read-table' || node.type === 'read-table-cached' || node.type === 'write-table') {
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

    // ── Write-table: also propagate input columns for preview ─────────────────
    // (handled above, but write-table additionally needs row-in column info)
    if (node.type === 'write-table') {
      const inputEdge = edges.find((e) => e.target === node.id && e.targetHandle === 'row-in')
      const inputCols = inputEdge ? getNodeOutputColumns(inputEdge.source, nodes, edges) : []
      return { ...node, data: { ...node.data, inputColumns: inputCols } }
    }

    return node
  })
}
