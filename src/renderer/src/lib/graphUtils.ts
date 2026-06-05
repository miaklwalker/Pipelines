/**
 * Pure graph-traversal utilities shared between App.tsx and node components.
 * Nothing here imports React or React Flow — just data manipulation.
 */

// ── Upstream node traversal ───────────────────────────────────────────────────
/**
 * Returns the set of node IDs that are upstream ancestors of `nodeId`
 * through row-stream edges only (col-out-* and conn-out edges are skipped
 * because they carry column values / DB connections, not row streams).
 */
export function getUpstreamNodeIds(nodeId: string, edges: AppEdge[]): Set<string> {
  const rowEdges = edges.filter((e) => {
    const sh = e.sourceHandle ?? ''
    return !sh.startsWith('col-') && sh !== 'conn-out'
  })

  const visited = new Set<string>()
  const queue = [nodeId]

  while (queue.length) {
    const current = queue.shift()!
    for (const e of rowEdges) {
      if (e.target === current && !visited.has(e.source)) {
        visited.add(e.source)
        queue.push(e.source)
      }
    }
  }

  return visited
}

// ── Node color propagation ─────────────────────────────────────────────────────
/**
 * Propagates user-set colors downstream through row-stream edges.
 *
 * Rules:
 *  - A node with an explicit user color is a "color source" — its color resets
 *    any upstream lineage and propagates to children as a single color.
 *  - A node with no explicit color inherits the *union* of all upstream source
 *    colors (one per distinct colored ancestor path).  When two differently-
 *    colored paths converge (e.g. a Join), the node receives both colors and
 *    displays them as a gradient.
 *  - Only row-stream edges carry color (col-out-* and conn-out edges do not).
 */
export function computeNodeDisplayColors(
  nodes: AppNode[],
  edges: AppEdge[],
  userColors: Record<string, string>,
): Record<string, string[]> {
  // Only row-stream edges propagate colour
  const rowEdges = edges.filter((e) => {
    const sh = e.sourceHandle ?? ''
    return !sh.startsWith('col-') && sh !== 'conn-out'
  })

  // Build adjacency + in-degree for topological sort (Kahn's algorithm)
  const children = new Map<string, string[]>(nodes.map((n) => [n.id, []]))
  const inDegree  = new Map<string, number>(nodes.map((n) => [n.id, 0]))

  for (const e of rowEdges) {
    children.get(e.source)?.push(e.target)
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1)
  }

  const queue     = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id)
  const colorSets = new Map<string, string[]>()

  while (queue.length) {
    const id = queue.shift()!

    if (userColors[id]) {
      // Explicit color — resets the lineage, only this color propagates forward
      colorSets.set(id, [userColors[id]])
    } else {
      // Inherit from all row-edge parents, deduplicated, order-stable
      const upstream = rowEdges
        .filter((e) => e.target === id)
        .flatMap((e) => colorSets.get(e.source) ?? [])
      colorSets.set(id, [...new Set(upstream)])
    }

    for (const child of children.get(id) ?? []) {
      const deg = (inDegree.get(child) ?? 1) - 1
      inDegree.set(child, deg)
      if (deg === 0) queue.push(child)
    }
  }

  return Object.fromEntries(colorSets)
}
import { getNodeOutputColumns } from './sqlBuilder'
import type {
  AppNode, AppEdge,
  JoinNodeData, JoinColSelection, DestinationNodeData,
  ConnectionNodeData, ReadTableNodeData, ReadTableCachedNodeData,
  UnnestNodeData, JsonExtractNodeData,
} from './types'

function sourceColumnFromHandle(sourceHandle: string | null | undefined): string | null {
  if (!sourceHandle) return null
  if (sourceHandle.startsWith('col-out-pass-')) return sourceHandle.slice('col-out-pass-'.length)
  if (sourceHandle.startsWith('col-out-fail-')) return sourceHandle.slice('col-out-fail-'.length)
  if (sourceHandle.startsWith('col-out-')) return sourceHandle.slice('col-out-'.length)
  return null
}

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
      || node.type === 'unique' || node.type === 'sort' || node.type === 'aggregate'
      || node.type === 'report') {
      const inputEdge = edges.find((e) => e.target === node.id && e.targetHandle === 'row-in')
      const inputCols = inputEdge ? getNodeOutputColumns(inputEdge.source, nodes, edges) : []
      return { ...node, data: { ...node.data, inputColumns: inputCols } }
    }

    // ── Unnest ───────────────────────────────────────────────────────────────
    if (node.type === 'unnest') {
      const d = node.data as UnnestNodeData
      const inputEdge = edges.find((e) => e.target === node.id && e.targetHandle === 'row-in')
      const inputCols = inputEdge ? getNodeOutputColumns(inputEdge.source, nodes, edges) : []
      const arrayColumn = inputCols.some((c) => c.name === d.arrayColumn) ? d.arrayColumn : ''
      return { ...node, data: { ...d, inputColumns: inputCols, arrayColumn } }
    }

    // ── JSON Extract ─────────────────────────────────────────────────────────
    if (node.type === 'json-extract') {
      const d = node.data as JsonExtractNodeData
      const inputEdge = edges.find((e) => e.target === node.id && e.targetHandle === 'row-in')
      const inputCols = inputEdge ? getNodeOutputColumns(inputEdge.source, nodes, edges) : []
      const sourceColumn = inputCols.some((c) => c.name === d.sourceColumn) ? d.sourceColumn : ''
      return { ...node, data: { ...d, inputColumns: inputCols, sourceColumn } }
    }

    // ── Destination ───────────────────────────────────────────────────────────
    if (node.type === 'destination') {
      const d = node.data as DestinationNodeData
      const connEdge = edges.find((e) => e.target === node.id && e.targetHandle === 'conn-in')
      let resolvedConfig: import('./types').PgConfig | null = null
      if (connEdge) {
        const connNode = nodes.find((n) => n.id === connEdge.source && n.type === 'connection')
        if (connNode) resolvedConfig = (connNode.data as ConnectionNodeData).config
      }

      const nextColMap = (d.colMap ?? []).map((mapping) => {
        if (!mapping.destCol) return mapping

        const inputEdge = edges.find((e) =>
          e.target === node.id && (
            e.targetHandle === `col-in-custom-${mapping.destCol}`
            || e.targetHandle === `col-in-${mapping.destCol}`
          )
        )

        if (!inputEdge) {
          // Edge was disconnected — clear the source so the mapping shows as unwired
          return mapping.sourceCol !== '' ? { ...mapping, sourceCol: '' } : mapping
        }

        const wiredSourceCol = sourceColumnFromHandle(inputEdge.sourceHandle)
        return wiredSourceCol && wiredSourceCol !== mapping.sourceCol
          ? { ...mapping, sourceCol: wiredSourceCol }
          : mapping
      })

      return { ...node, data: { ...d, resolvedConfig, colMap: nextColMap } }
    }

    // ── Merge ─────────────────────────────────────────────────────────────────
    if (node.type === 'merge' || node.type === 'concat') {
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
      const hasCarry = node.type === 'increment-value'
        ? edges.some((e) => e.target === node.id && e.targetHandle === 'col-in-carry')
        : undefined
      if (node.type === 'increment-value') {
        const carryEdge = edges.find((e) => e.target === node.id && e.targetHandle === 'col-in-carry')
        let carryFromLastValue: number | null = null
        if (carryEdge) {
          const carryNode = nodes.find((n) => n.id === carryEdge.source && n.type === 'increment-value')
          const carryValue = carryNode ? (carryNode.data as IncrementValueData).lastValue : null
          carryFromLastValue = typeof carryValue === 'number' ? carryValue : null
        }
        return {
          ...node,
          data: { ...node.data, hasAnchor, hasCarry, carryFromLastValue },
        }
      }
      return { ...node, data: { ...node.data, hasAnchor, ...(hasCarry !== undefined ? { hasCarry } : {}) } }
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
