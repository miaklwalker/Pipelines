/**
 * Execution planner — decides WHAT runs and in WHAT order when the user hits
 * Run / Full Run, or when a cache refresh cascades downstream.
 *
 * Replaces the old sink-only ordering in App.tsx, which had three problems:
 *  1. Only write-table / csv-output sinks were sequenced — seq wires attached
 *     to work nodes (Materialize, Read Cached, API requests) never executed.
 *  2. The Full-Run refresh pre-pass ignored seq edges and used a pairwise
 *     Array.sort comparator, which is not a valid topological sort — diverging
 *     and re-merging branches could refresh in the wrong order.
 *  3. Cascades re-ran sinks without refreshing intermediate Materialize nodes,
 *     so "refreshed" data could still be served from stale parquet.
 *
 * The planner is pure (no React, no window.api) so it is unit-testable.
 */
import type { AppNode, AppEdge, WriteTableNodeData, UpdateDbRowNodeData, RawQueryNodeData } from './types'
import { getUpstreamNodeIds, getDownstreamNodeIds, isSeqEdge, topoSort } from './traversal'

export type ExecActionKind =
  | 'materialize'      // re-run upstream SQL into parquet
  | 'refresh-cache'    // force re-fetch a cached DB read
  | 'api-fetch'        // run an API request node (get/delete/post/put/patch/paginated)
  | 'write-table'      // sink: insert into Postgres
  | 'csv-export'       // sink: export CSV
  | 'update-rows'      // sink: UPDATE rows in Postgres by PK
  | 'raw-query'        // sink: execute arbitrary SQL against Postgres

export interface ExecAction {
  nodeId: string
  kind: ExecActionKind
}

export interface PlanOptions {
  /** Full Run: refresh every materialize / cached read feeding the selected sinks. */
  fullRefresh?: boolean
  /**
   * Cascade mode: these nodes just refreshed. Plan re-runs everything downstream
   * of them — including intermediate materialize nodes — plus the affected sinks.
   */
  cascadeFrom?: Set<string>
  /** Restrict to specific sink node ids (otherwise: every valid sink). */
  targetSinkIds?: Set<string>
}

export function isRunnableSink(n: AppNode): boolean {
  if (n.type === 'csv-output') return true
  if (n.type === 'write-table') {
    const d = n.data as WriteTableNodeData
    return !!d.resolvedConfig && !!d.tableName
  }
  if (n.type === 'update-db-row') {
    const d = n.data as UpdateDbRowNodeData
    return !!d.resolvedConfig && !!d.tableName && !!d.pkColumn
  }
  if (n.type === 'raw-query') {
    const d = n.data as RawQueryNodeData
    return !!d.resolvedConfig && !!d.sql?.trim()
  }
  return false
}

const API_TYPES = new Set(['api-get', 'api-delete', 'api-post', 'api-put', 'api-patch', 'api-paginated'])

function actionKind(n: AppNode): ExecActionKind | null {
  if (n.type === 'csv-output') return 'csv-export'
  if (n.type === 'write-table') return 'write-table'
  if (n.type === 'materialize') return 'materialize'
  if (n.type === 'read-table-cached') return 'refresh-cache'
  if (API_TYPES.has(n.type ?? '')) return 'api-fetch'
  if (n.type === 'update-db-row') return 'update-rows'
  if (n.type === 'raw-query') return 'raw-query'
  return null
}

/** Undirected reachability over seq edges — the "sequence cluster" of a node. */
function seqCluster(nodeId: string, seqEdges: AppEdge[]): Set<string> {
  const seen = new Set<string>([nodeId])
  let frontier = [nodeId]
  while (frontier.length) {
    const next: string[] = []
    for (const id of frontier) {
      for (const e of seqEdges) {
        if (e.source === id && !seen.has(e.target)) { seen.add(e.target); next.push(e.target) }
        if (e.target === id && !seen.has(e.source)) { seen.add(e.source); next.push(e.source) }
      }
    }
    frontier = next
  }
  return seen
}

/**
 * Plan the ordered list of actions for one execution.
 *
 * Included nodes:
 *  - the selected sinks (always)
 *  - fullRefresh: every materialize / cached read data-upstream of those sinks
 *  - cascadeFrom: every materialize / cached read that sits BETWEEN a refreshed
 *    node and a selected sink (downstream of the source, upstream of the sink)
 *  - any executable node wired into the same sequence cluster as a selected
 *    sink — attaching a seq wire is the explicit opt-in that makes work nodes
 *    (API fetches, materialize, cached reads) part of the run
 *
 * Ordering: Kahn topological sort where action B depends on action A when
 * A is data-upstream of B or A reaches B through directed seq edges. This is
 * a real partial-order sort, so diverge-and-merge graphs (A→B→E, A→C→D→E)
 * come out in a correct order.
 */
export function planExecution(nodes: AppNode[], edges: AppEdge[], opts: PlanOptions = {}): ExecAction[] {
  const seqEdges = edges.filter(isSeqEdge)

  // ── 1. Select sinks ────────────────────────────────────────────────────────
  let sinks = nodes.filter(isRunnableSink)
  if (opts.targetSinkIds) sinks = sinks.filter((s) => opts.targetSinkIds!.has(s.id))
  if (opts.cascadeFrom?.size) {
    const downstream = new Set<string>()
    for (const src of opts.cascadeFrom) {
      for (const id of getDownstreamNodeIds(src, edges)) downstream.add(id)
    }
    sinks = sinks.filter((s) => downstream.has(s.id))
  }
  if (!sinks.length) return []

  const include = new Set<string>(sinks.map((s) => s.id))

  // Data-upstream sets are reused for both selection and ordering.
  const upstreamOf = new Map<string, Set<string>>()
  const upstream = (id: string): Set<string> => {
    let u = upstreamOf.get(id)
    if (!u) { u = getUpstreamNodeIds(id, edges); upstreamOf.set(id, u) }
    return u
  }

  const sinkUpstream = new Set<string>()
  for (const s of sinks) for (const id of upstream(s.id)) sinkUpstream.add(id)

  // ── 2. Full Run: refresh all upstream caches ───────────────────────────────
  if (opts.fullRefresh) {
    for (const n of nodes) {
      if ((n.type === 'materialize' || n.type === 'read-table-cached') && sinkUpstream.has(n.id)) {
        include.add(n.id)
      }
    }
  }

  // ── 3. Cascade: refresh intermediates between source and sink ──────────────
  if (opts.cascadeFrom?.size) {
    const downstreamOfSource = new Set<string>()
    for (const src of opts.cascadeFrom) {
      for (const id of getDownstreamNodeIds(src, edges)) downstreamOfSource.add(id)
    }
    for (const n of nodes) {
      if (n.type !== 'materialize' && n.type !== 'read-table-cached') continue
      if (opts.cascadeFrom.has(n.id)) continue   // the source already refreshed itself
      if (downstreamOfSource.has(n.id) && sinkUpstream.has(n.id)) include.add(n.id)
    }
  }

  // ── 4. Seq-wired executables join the run ──────────────────────────────────
  if (seqEdges.length) {
    const clusters = new Set<string>()
    for (const s of sinks) {
      for (const id of seqCluster(s.id, seqEdges)) clusters.add(id)
    }
    for (const n of nodes) {
      if (include.has(n.id) || !clusters.has(n.id)) continue
      if (opts.cascadeFrom?.has(n.id)) continue   // the source already refreshed itself
      if (actionKind(n) !== null && !isRunnableSink(n)) include.add(n.id)
    }
  }

  // ── 5. Order: data edges + directed seq reachability ───────────────────────
  const ids = [...include]
  const seqReach = new Map<string, Set<string>>()
  for (const id of ids) {
    // all nodes reachable FROM id via directed seq edges
    seqReach.set(id, getDownstreamNodeIds(id, seqEdges))
  }

  const ordered = topoSort(ids, (id) => {
    const deps = new Set<string>()
    const up = upstream(id)
    for (const other of ids) {
      if (other === id) continue
      if (up.has(other)) deps.add(other)               // data dependency
      if (seqReach.get(other)?.has(id)) deps.add(other) // seq dependency
    }
    return deps
  })

  const byId = new Map(nodes.map((n) => [n.id, n]))
  return ordered.flatMap((id) => {
    const n = byId.get(id)
    const kind = n ? actionKind(n) : null
    return kind ? [{ nodeId: id, kind }] : []
  })
}
