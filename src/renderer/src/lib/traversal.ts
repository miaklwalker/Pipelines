/**
 * Pure graph-traversal helpers shared by graphUtils, sqlBuilder, and the
 * execution planner. No React, no React Flow — just edge walking.
 *
 * Edge taxonomy (by sourceHandle):
 *  - row stream:  row-out, row-out-pass/fail, TOP_RIGHT corner outs … (default)
 *  - column:      col-out, col-out-{name}, col-out-pass-{name}, …
 *  - connection:  conn-out
 *  - token:       token-out
 *  - sequence:    seq-out   (execution ordering only — never carries data)
 */
import type { AppEdge } from './types'

/** True when the edge carries a row stream (data), not col/conn/token/seq. */
export function isRowStreamEdge(e: AppEdge): boolean {
  const sh = e.sourceHandle ?? ''
  return !sh.startsWith('col-') && sh !== 'conn-out' && sh !== 'token-out' && sh !== 'seq-out'
}

/** True for seq-out → seq-in ordering edges. */
export function isSeqEdge(e: AppEdge): boolean {
  return e.sourceHandle === 'seq-out' && e.targetHandle === 'seq-in'
}

/**
 * Node IDs that are upstream ancestors of `nodeId` through row-stream edges
 * only (column, connection, token, and sequence edges are skipped — they don't
 * carry row data).
 */
export function getUpstreamNodeIds(nodeId: string, edges: AppEdge[]): Set<string> {
  const rowEdges = edges.filter(isRowStreamEdge)
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

/** Node IDs strictly downstream of `nodeId` via the given edges. */
export function getDownstreamNodeIds(
  nodeId: string,
  edges: AppEdge[],
  filter?: (e: AppEdge) => boolean
): Set<string> {
  const usable = filter ? edges.filter(filter) : edges
  const seen = new Set<string>()
  let frontier = [nodeId]
  while (frontier.length) {
    const next: string[] = []
    for (const sid of frontier) {
      for (const e of usable) {
        if (e.source === sid && !seen.has(e.target)) {
          seen.add(e.target)
          next.push(e.target)
        }
      }
    }
    frontier = next
  }
  return seen
}

/**
 * Kahn topological sort of `ids` under a dependency relation.
 * `dependsOn(b)` returns the set of ids (within `ids`) that must come before b.
 * Nodes caught in cycles are appended at the end in input order so callers
 * always get every id back.
 */
export function topoSort(ids: string[], dependsOn: (id: string) => Set<string>): string[] {
  const idSet = new Set(ids)
  const deps = new Map<string, Set<string>>()
  for (const id of ids) {
    deps.set(id, new Set([...dependsOn(id)].filter((d) => idSet.has(d) && d !== id)))
  }
  const ordered: string[] = []
  const ready = ids.filter((id) => deps.get(id)!.size === 0)
  const done = new Set<string>()
  while (ready.length) {
    const id = ready.shift()!
    if (done.has(id)) continue
    done.add(id)
    ordered.push(id)
    for (const other of ids) {
      if (done.has(other)) continue
      const d = deps.get(other)!
      if (d.delete(id) && d.size === 0) ready.push(other)
    }
  }
  for (const id of ids) {
    if (!done.has(id)) ordered.push(id)   // cycle fallback
  }
  return ordered
}
