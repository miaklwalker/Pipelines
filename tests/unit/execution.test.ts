/**
 * Unit tests for the execution planner (lib/execution.ts) and the shared
 * traversal helpers (lib/traversal.ts).
 *
 * The planner replaced App.tsx's sink-only ordering; these tests pin down the
 * behaviours that were previously broken:
 *  - diverge-and-merge sequence graphs (A→B→E, A→C→D→E) order correctly
 *  - seq-wired work nodes (caches, API fetches) join the run
 *  - cascades refresh intermediate materialize nodes between source and sink
 *  - Full Run refreshes are ordered by a real topological sort
 */
import { describe, it, expect } from 'vitest'
import { planExecution } from '../../src/renderer/src/lib/execution'
import { getUpstreamNodeIds, isRowStreamEdge, topoSort } from '../../src/renderer/src/lib/traversal'
import type { AppNode, AppEdge } from '../../src/renderer/src/lib/types'

const pos = { x: 0, y: 0 }
const pgConfig = { host: 'h', port: 5432, database: 'd', user: 'u', password: 'p', ssl: false }

function csvIn(id: string): AppNode {
  return { id, type: 'csv-input', position: pos, data: { fileName: 'f.csv', filePath: '/f.csv', columns: [] } } as AppNode
}
function csvOut(id: string): AppNode {
  return { id, type: 'csv-output', position: pos, data: { outputPath: '/o.csv', includeHeader: true, inputColumns: [], lastExport: null } } as AppNode
}
function writeTable(id: string, configured = true): AppNode {
  return {
    id, type: 'write-table', position: pos,
    data: { tableName: configured ? 't' : '', writeMode: 'append', status: 'idle', rowCount: null, inputColumns: [], resolvedConfig: configured ? pgConfig : null },
  } as AppNode
}
function materialize(id: string): AppNode {
  return { id, type: 'materialize', position: pos, data: { parquetPath: '/m.parquet', columns: [], status: 'idle', rowCount: null } } as AppNode
}
function cachedRead(id: string): AppNode {
  return {
    id, type: 'read-table-cached', position: pos,
    data: { readMode: 'table', tableName: 't', customSQL: '', csvPath: '/c.csv', columns: [], rowCount: null, status: 'ready', resolvedConfig: pgConfig, cacheDate: null },
  } as AppNode
}
function apiGet(id: string): AppNode {
  return { id, type: 'api-get', position: pos, data: { method: 'GET', url: 'http://x', headers: [], jsonPath: null, columns: [], rowCount: null, status: 'idle' } } as AppNode
}

function rowEdge(id: string, source: string, target: string, th = 'row-in'): AppEdge {
  return { id, source, target, sourceHandle: 'row-out', targetHandle: th }
}
function seqEdge(id: string, source: string, target: string): AppEdge {
  return { id, source, target, sourceHandle: 'seq-out', targetHandle: 'seq-in' }
}

const order = (plan: { nodeId: string }[]) => plan.map((a) => a.nodeId)
const before = (plan: { nodeId: string }[], a: string, b: string) => {
  const ids = order(plan)
  expect(ids).toContain(a)
  expect(ids).toContain(b)
  expect(ids.indexOf(a)).toBeLessThan(ids.indexOf(b))
}

// ── traversal ─────────────────────────────────────────────────────────────────

describe('traversal', () => {
  it('isRowStreamEdge excludes seq, token, col, and conn edges', () => {
    expect(isRowStreamEdge(rowEdge('e', 'a', 'b'))).toBe(true)
    expect(isRowStreamEdge({ id: 'e', source: 'a', target: 'b', sourceHandle: 'row-out-pass', targetHandle: 'row-in' })).toBe(true)
    expect(isRowStreamEdge(seqEdge('e', 'a', 'b'))).toBe(false)
    expect(isRowStreamEdge({ id: 'e', source: 'a', target: 'b', sourceHandle: 'token-out', targetHandle: 'token-in' })).toBe(false)
    expect(isRowStreamEdge({ id: 'e', source: 'a', target: 'b', sourceHandle: 'col-out-x', targetHandle: 'col-in-y' })).toBe(false)
    expect(isRowStreamEdge({ id: 'e', source: 'a', target: 'b', sourceHandle: 'conn-out', targetHandle: 'conn-in' })).toBe(false)
  })

  it('getUpstreamNodeIds does not walk sequence wires', () => {
    const edges = [rowEdge('e1', 'src', 'mid'), rowEdge('e2', 'mid', 'sink'), seqEdge('e3', 'other', 'sink')]
    const up = getUpstreamNodeIds('sink', edges)
    expect(up.has('src')).toBe(true)
    expect(up.has('mid')).toBe(true)
    expect(up.has('other')).toBe(false)
  })

  it('topoSort orders a diamond and survives cycles', () => {
    // a → b, a → c, b → d, c → d
    const deps: Record<string, string[]> = { a: [], b: ['a'], c: ['a'], d: ['b', 'c'] }
    const sorted = topoSort(['d', 'c', 'b', 'a'], (id) => new Set(deps[id]))
    expect(sorted.indexOf('a')).toBeLessThan(sorted.indexOf('b'))
    expect(sorted.indexOf('a')).toBeLessThan(sorted.indexOf('c'))
    expect(sorted.indexOf('b')).toBeLessThan(sorted.indexOf('d'))
    expect(sorted.indexOf('c')).toBeLessThan(sorted.indexOf('d'))

    const cyc = topoSort(['x', 'y'], (id) => new Set(id === 'x' ? ['y'] : ['x']))
    expect(cyc.sort()).toEqual(['x', 'y'])   // everything still returned
  })
})

// ── planner: sinks ────────────────────────────────────────────────────────────

describe('planExecution — sinks', () => {
  it('plans every valid sink and skips unconfigured write-tables', () => {
    const nodes = [csvIn('src'), csvOut('out1'), writeTable('wt1'), writeTable('wt2', false)]
    const edges = [rowEdge('e1', 'src', 'out1'), rowEdge('e2', 'src', 'wt1'), rowEdge('e3', 'src', 'wt2')]
    const plan = planExecution(nodes, edges)
    expect(order(plan).sort()).toEqual(['out1', 'wt1'])
  })

  it('returns an empty plan when there are no sinks', () => {
    expect(planExecution([csvIn('a'), materialize('m')], [rowEdge('e', 'a', 'm')])).toEqual([])
  })
})

// ── planner: sequence diamonds (the bug report) ───────────────────────────────

describe('planExecution — sequence ordering', () => {
  it('orders a linear seq chain of sinks', () => {
    const nodes = [csvIn('src'), csvOut('A'), csvOut('B'), csvOut('C')]
    const edges = [
      rowEdge('e1', 'src', 'A'), rowEdge('e2', 'src', 'B'), rowEdge('e3', 'src', 'C'),
      seqEdge('s1', 'A', 'B'), seqEdge('s2', 'B', 'C'),
    ]
    expect(order(planExecution(nodes, edges))).toEqual(['A', 'B', 'C'])
  })

  it('orders the diverge-merge diamond A→B→E / A→C→D→E', () => {
    const nodes = [csvIn('src'), csvOut('A'), csvOut('B'), csvOut('C'), csvOut('D'), csvOut('E')]
    const edges = [
      ...['A', 'B', 'C', 'D', 'E'].map((id, i) => rowEdge(`r${i}`, 'src', id)),
      seqEdge('s1', 'A', 'B'), seqEdge('s2', 'B', 'E'),
      seqEdge('s3', 'A', 'C'), seqEdge('s4', 'C', 'D'), seqEdge('s5', 'D', 'E'),
    ]
    const plan = planExecution(nodes, edges)
    before(plan, 'A', 'B'); before(plan, 'A', 'C')
    before(plan, 'B', 'E'); before(plan, 'C', 'D'); before(plan, 'D', 'E')
    expect(order(plan)).toHaveLength(5)
  })

  it('runs seq-wired work nodes (cache, API) between sinks in order', () => {
    // A (sink) →seq cache →seq api →seq E (sink): the middle nodes execute too
    const nodes = [csvIn('src'), csvOut('A'), cachedRead('cache'), apiGet('api'), csvOut('E')]
    const edges = [
      rowEdge('r1', 'src', 'A'), rowEdge('r2', 'src', 'E'),
      seqEdge('s1', 'A', 'cache'), seqEdge('s2', 'cache', 'api'), seqEdge('s3', 'api', 'E'),
    ]
    const plan = planExecution(nodes, edges)
    expect(order(plan)).toEqual(['A', 'cache', 'api', 'E'])
    expect(plan.find((a) => a.nodeId === 'cache')!.kind).toBe('refresh-cache')
    expect(plan.find((a) => a.nodeId === 'api')!.kind).toBe('api-fetch')
  })

  it('survives a seq cycle and still plans every sink', () => {
    const nodes = [csvIn('src'), csvOut('A'), csvOut('B')]
    const edges = [
      rowEdge('r1', 'src', 'A'), rowEdge('r2', 'src', 'B'),
      seqEdge('s1', 'A', 'B'), seqEdge('s2', 'B', 'A'),
    ]
    expect(order(planExecution(nodes, edges)).sort()).toEqual(['A', 'B'])
  })
})

// ── planner: Full Run refresh ─────────────────────────────────────────────────

describe('planExecution — fullRefresh', () => {
  it('refreshes upstream caches before dependent materialize, before the sink', () => {
    // cache → mat → sink (a diamond-safe data chain)
    const nodes = [cachedRead('cache'), materialize('mat'), csvOut('sink')]
    const edges = [rowEdge('e1', 'cache', 'mat'), rowEdge('e2', 'mat', 'sink')]
    const plan = planExecution(nodes, edges, { fullRefresh: true })
    expect(order(plan)).toEqual(['cache', 'mat', 'sink'])
  })

  it('orders a refresh diamond correctly (cache feeds two materializes feeding one sink)', () => {
    const nodes = [cachedRead('cache'), materialize('m1'), materialize('m2'), csvOut('sink')]
    const edges = [
      rowEdge('e1', 'cache', 'm1'), rowEdge('e2', 'cache', 'm2'),
      rowEdge('e3', 'm1', 'sink'), rowEdge('e4', 'm2', 'sink', 'row-left'),
    ]
    const plan = planExecution(nodes, edges, { fullRefresh: true })
    before(plan, 'cache', 'm1'); before(plan, 'cache', 'm2')
    before(plan, 'm1', 'sink');  before(plan, 'm2', 'sink')
  })

  it('does not refresh caches that feed no selected sink', () => {
    const nodes = [cachedRead('cache'), csvOut('sink'), cachedRead('unrelated')]
    const edges = [rowEdge('e1', 'cache', 'sink')]
    const plan = planExecution(nodes, edges, { fullRefresh: true })
    expect(order(plan)).toEqual(['cache', 'sink'])
  })
})

// ── planner: cascade ──────────────────────────────────────────────────────────

describe('planExecution — cascade', () => {
  it('re-runs intermediate materialize nodes between the source and the sink', () => {
    // cache (just refreshed) → mat → sink: mat must re-run or the sink writes stale parquet
    const nodes = [cachedRead('cache'), materialize('mat'), csvOut('sink')]
    const edges = [rowEdge('e1', 'cache', 'mat'), rowEdge('e2', 'mat', 'sink')]
    const plan = planExecution(nodes, edges, { cascadeFrom: new Set(['cache']) })
    expect(order(plan)).toEqual(['mat', 'sink'])   // source itself already refreshed
  })

  it('only targets sinks downstream of the refreshed node', () => {
    const nodes = [cachedRead('cache'), csvOut('down'), csvOut('elsewhere'), csvIn('src')]
    const edges = [rowEdge('e1', 'cache', 'down'), rowEdge('e2', 'src', 'elsewhere')]
    const plan = planExecution(nodes, edges, { cascadeFrom: new Set(['cache']) })
    expect(order(plan)).toEqual(['down'])
  })

  it('merges multiple cascade sources into one plan', () => {
    const nodes = [cachedRead('c1'), cachedRead('c2'), csvOut('s1'), csvOut('s2')]
    const edges = [rowEdge('e1', 'c1', 's1'), rowEdge('e2', 'c2', 's2')]
    const plan = planExecution(nodes, edges, { cascadeFrom: new Set(['c1', 'c2']) })
    expect(order(plan).sort()).toEqual(['s1', 's2'])
  })

  it('returns an empty plan when nothing is downstream', () => {
    const nodes = [cachedRead('cache'), csvOut('sink'), csvIn('src')]
    const edges = [rowEdge('e1', 'src', 'sink')]
    expect(planExecution(nodes, edges, { cascadeFrom: new Set(['cache']) })).toEqual([])
  })
})

describe('planExecution — cascade + seq interplay', () => {
  it('does not re-refresh a cascade source that is also seq-wired to its sink', () => {
    const nodes = [cachedRead('cache'), csvOut('sink')]
    const edges = [
      rowEdge('e1', 'cache', 'sink'),
      seqEdge('s1', 'cache', 'sink'),
    ]
    const plan = planExecution(nodes, edges, { cascadeFrom: new Set(['cache']) })
    expect(order(plan)).toEqual(['sink'])
  })
})
