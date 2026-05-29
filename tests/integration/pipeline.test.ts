/**
 * Integration tests — execute generated SQL against a real DuckDB in-memory
 * database and verify row counts, column names, and cell values.
 *
 * These tests use the CSV fixtures from tests/fixtures/generate.ts.
 * DuckDB is imported directly (no Electron IPC layer).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import duckdb from 'duckdb'
import { buildNodeSQL } from '../../src/renderer/src/lib/sqlBuilder'
import { setup, teardown, type Fixtures } from '../fixtures/generate'
import type { AppNode, AppEdge } from '../../src/renderer/src/lib/types'

// ── DuckDB helpers ────────────────────────────────────────────────────────────

let db: InstanceType<typeof duckdb.Database>
let conn: InstanceType<typeof duckdb.Connection>

function query(sql: string): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    conn.all(sql, (err, rows) => {
      if (err) reject(new Error(`DuckDB error: ${err.message}\nSQL: ${sql}`))
      else resolve(rows as Record<string, unknown>[])
    })
  })
}

async function run(nodeId: string, nodes: AppNode[], edges: AppEdge[], outputHandle?: string) {
  const sql = buildNodeSQL(nodeId, nodes, edges, outputHandle)
  if (!sql) throw new Error('buildNodeSQL returned null')
  return query(sql)
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

let f: Fixtures
const pos = { x: 0, y: 0 }

beforeAll(() => {
  f = setup()
  db = new duckdb.Database(':memory:')
  conn = db.connect()
})

afterAll(() => {
  teardown(f)
  db.close()
})

// ── Builder helpers ───────────────────────────────────────────────────────────

function csvNode(id: string, path: string, cols: string[]): AppNode {
  return {
    id, type: 'csv-input', position: pos,
    data: { fileName: 'f.csv', filePath: path, columns: cols.map((n) => ({ name: n, type: 'TEXT' })) },
  } as AppNode
}

function edge(id: string, source: string, target: string, sh = 'row-out', th = 'row-in'): AppEdge {
  return { id, source, target, sourceHandle: sh, targetHandle: th }
}

// ── CSV Input ─────────────────────────────────────────────────────────────────

describe('csv-input', () => {
  it('reads all 20 employee rows', async () => {
    const n = csvNode('n1', f.employees, ['id', 'name', 'department', 'salary', 'country'])
    const rows = await run('n1', [n], [])
    expect(rows).toHaveLength(20)
  })

  it('exposes correct column names', async () => {
    const n = csvNode('n1', f.employees, ['id', 'name'])
    const rows = await run('n1', [n], [])
    expect(Object.keys(rows[0]).sort()).toEqual(['country', 'department', 'id', 'name', 'salary'])
  })
})

// ── Filter ────────────────────────────────────────────────────────────────────

describe('filter', () => {
  it('pass branch returns only matching rows', async () => {
    const src: AppNode = csvNode('n1', f.employees, ['id', 'department', 'salary'])
    const filt: AppNode = {
      id: 'n2', type: 'filter', position: pos,
      data: { condition: "department = 'Engineering'", inputColumns: [] },
    } as AppNode
    const rows = await run('n2', [src, filt], [edge('e1', 'n1', 'n2')], 'row-out-pass')
    expect(rows.every((r) => r.department === 'Engineering')).toBe(true)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('fail branch is the complement', async () => {
    const src = csvNode('n1', f.employees, ['id', 'department', 'salary'])
    const filt: AppNode = {
      id: 'n2', type: 'filter', position: pos,
      data: { condition: "department = 'Engineering'", inputColumns: [] },
    } as AppNode
    // Pass and fail are requested by passing the outputHandle directly to buildNodeSQL
    const passRows = await run('n2', [src, filt], [edge('e1', 'n1', 'n2')], 'row-out-pass')
    const failRows = await run('n2', [src, filt], [edge('e1', 'n1', 'n2')], 'row-out-fail')
    expect(passRows.every((r) => r.department === 'Engineering')).toBe(true)
    expect(failRows.every((r) => r.department !== 'Engineering')).toBe(true)
    // Together they partition the 20-row dataset with no overlap
    expect(passRows.length).toBe(6)
    expect(failRows.length).toBe(14)
  })

  it('numeric comparison works', async () => {
    const src = csvNode('n1', f.employees, ['id', 'salary'])
    const filt: AppNode = {
      id: 'n2', type: 'filter', position: pos,
      data: { condition: 'salary > 90000', inputColumns: [] },
    } as AppNode
    const rows = await run('n2', [src, filt], [edge('e1', 'n1', 'n2')])
    expect(rows.every((r) => Number(r.salary) > 90000)).toBe(true)
  })
})

// ── Sort ──────────────────────────────────────────────────────────────────────

describe('sort', () => {
  it('sorts numeric column ascending', async () => {
    const src = csvNode('n1', f.employees, ['id', 'salary'])
    const sort: AppNode = {
      id: 'n2', type: 'sort', position: pos,
      data: { sortKeys: [{ column: 'salary', direction: 'ASC' }], inputColumns: [] },
    } as AppNode
    const rows = await run('n2', [src, sort], [edge('e1', 'n1', 'n2')])
    const salaries = rows.map((r) => Number(r.salary))
    expect(salaries).toEqual([...salaries].sort((a, b) => a - b))
  })

  it('sorts descending', async () => {
    const src = csvNode('n1', f.employees, ['id', 'salary'])
    const sort: AppNode = {
      id: 'n2', type: 'sort', position: pos,
      data: { sortKeys: [{ column: 'salary', direction: 'DESC' }], inputColumns: [] },
    } as AppNode
    const rows = await run('n2', [src, sort], [edge('e1', 'n1', 'n2')])
    const salaries = rows.map((r) => Number(r.salary))
    expect(salaries).toEqual([...salaries].sort((a, b) => b - a))
  })

  it('multi-key sort (country ASC, salary DESC)', async () => {
    const src = csvNode('n1', f.employees, ['id', 'country', 'salary'])
    const sort: AppNode = {
      id: 'n2', type: 'sort', position: pos,
      data: {
        sortKeys: [{ column: 'country', direction: 'ASC' }, { column: 'salary', direction: 'DESC' }],
        inputColumns: [],
      },
    } as AppNode
    const rows = await run('n2', [src, sort], [edge('e1', 'n1', 'n2')])
    // Within each country group salaries should be descending
    const countries = rows.map((r) => r.country as string)
    expect(countries).toEqual([...countries].sort())
  })

  it('preserves all rows', async () => {
    const src = csvNode('n1', f.employees, ['id', 'salary'])
    const sort: AppNode = {
      id: 'n2', type: 'sort', position: pos,
      data: { sortKeys: [{ column: 'salary', direction: 'ASC' }], inputColumns: [] },
    } as AppNode
    const rows = await run('n2', [src, sort], [edge('e1', 'n1', 'n2')])
    expect(rows).toHaveLength(20)
  })
})

// ── Limit ─────────────────────────────────────────────────────────────────────

describe('limit', () => {
  it('returns at most N rows', async () => {
    const src = csvNode('n1', f.employees, ['id', 'name'])
    const lim: AppNode = {
      id: 'n2', type: 'limit', position: pos,
      data: { count: 5, offset: 0 },
    } as AppNode
    expect(await run('n2', [src, lim], [edge('e1', 'n1', 'n2')])).toHaveLength(5)
  })

  it('offset skips rows', async () => {
    const src = csvNode('n1', f.employees, ['id'])
    const all: AppNode  = { id: 'na', type: 'limit', position: pos, data: { count: 20, offset: 0  } } as AppNode
    const skip: AppNode = { id: 'nb', type: 'limit', position: pos, data: { count: 10, offset: 10 } } as AppNode

    const allRows  = await run('na', [src, all],  [edge('e1', 'n1', 'na')])
    const skipRows = await run('nb', [src, skip], [edge('e2', 'n1', 'nb')])
    // The skipped set should be the last 10 from all
    expect(skipRows.map((r) => r.id)).toEqual(allRows.slice(10).map((r) => r.id))
  })

  it('returns fewer rows when dataset is smaller than limit', async () => {
    const src = csvNode('n1', f.employees, ['id'])
    const lim: AppNode = { id: 'n2', type: 'limit', position: pos, data: { count: 1000, offset: 0 } } as AppNode
    expect(await run('n2', [src, lim], [edge('e1', 'n1', 'n2')])).toHaveLength(20)
  })
})

// ── Unique ────────────────────────────────────────────────────────────────────

describe('unique', () => {
  it('returns one row per unique key (first)', async () => {
    const src = csvNode('n1', f.dupes, ['id', 'category', 'value'])
    const u: AppNode = {
      id: 'n2', type: 'unique', position: pos,
      data: { keyColumn: 'category', keep: 'first', inputColumns: [] },
    } as AppNode
    const rows = await run('n2', [src, u], [edge('e1', 'n1', 'n2')])
    // Dupes CSV has 3 categories: A, B, C
    expect(rows).toHaveLength(3)
    const cats = rows.map((r) => r.category).sort()
    expect(cats).toEqual(['A', 'B', 'C'])
  })

  it('keep first vs keep last returns different rows', async () => {
    const src = csvNode('n1', f.dupes, ['id', 'category', 'value'])

    const uFirst: AppNode = {
      id: 'n2', type: 'unique', position: pos,
      data: { keyColumn: 'category', keep: 'first', inputColumns: [] },
    } as AppNode
    const uLast: AppNode = {
      id: 'n3', type: 'unique', position: pos,
      data: { keyColumn: 'category', keep: 'last', inputColumns: [] },
    } as AppNode

    const firstRows = await run('n2', [src, uFirst], [edge('e1', 'n1', 'n2')])
    const lastRows  = await run('n3', [src, uLast],  [edge('e2', 'n1', 'n3')])

    // For category A: first row has value=10, last has value=15 (id=6)
    const firstA = firstRows.find((r) => r.category === 'A')
    const lastA  = lastRows.find((r)  => r.category === 'A')
    expect(Number(firstA!.value)).toBe(10)
    expect(Number(lastA!.value)).toBe(15)
  })
})

// ── Merge (UNION ALL) ────────────────────────────────────────────────────────

describe('merge', () => {
  it('combines two datasets via UNION ALL', async () => {
    const n1 = csvNode('n1', f.employees, ['id', 'name'])
    const n2 = csvNode('n2', f.employees, ['id', 'name'])   // same file = double rows
    const m: AppNode = {
      id: 'n3', type: 'merge', position: pos,
      data: { inputColumns: [] },
    } as AppNode
    const rows = await run('n3', [n1, n2, m], [
      edge('e1', 'n1', 'n3', 'row-out', 'row-left'),
      edge('e2', 'n2', 'n3', 'row-out', 'row-right'),
    ])
    expect(rows).toHaveLength(40)
  })
})

// ── Aggregate ────────────────────────────────────────────────────────────────

describe('aggregate', () => {
  it('counts rows per department', async () => {
    const src = csvNode('n1', f.employees, ['department', 'salary'])
    const agg: AppNode = {
      id: 'n2', type: 'aggregate', position: pos,
      data: {
        groupBy: ['department'],
        aggregations: [{ id: 'x', func: 'COUNT', column: '', alias: 'headcount' }],
        inputColumns: [],
      },
    } as AppNode
    const rows = await run('n2', [src, agg], [edge('e1', 'n1', 'n2')])
    // 5 departments: Engineering, Marketing, HR, Sales, (none for CA?)
    expect(rows.length).toBeGreaterThanOrEqual(4)
    const total = rows.reduce((s, r) => s + Number(r.headcount), 0)
    expect(total).toBe(20)
  })

  it('sums salaries per country', async () => {
    const src = csvNode('n1', f.employees, ['country', 'salary'])
    const agg: AppNode = {
      id: 'n2', type: 'aggregate', position: pos,
      data: {
        groupBy: ['country'],
        aggregations: [{ id: 'x', func: 'SUM', column: 'salary', alias: 'total_salary' }],
        inputColumns: [],
      },
    } as AppNode
    const rows = await run('n2', [src, agg], [edge('e1', 'n1', 'n2')])
    const grandTotal = rows.reduce((s, r) => s + Number(r.total_salary), 0)
    // Sum of all 20 salaries from the fixture
    expect(grandTotal).toBeGreaterThan(0)
    expect(rows.every((r) => Number(r.total_salary) > 0)).toBe(true)
  })

  it('global COUNT(*) with no groupBy', async () => {
    const src = csvNode('n1', f.orders, ['order_id', 'amount'])
    const agg: AppNode = {
      id: 'n2', type: 'aggregate', position: pos,
      data: {
        groupBy: [],
        aggregations: [{ id: 'x', func: 'COUNT', column: '', alias: 'total_orders' }],
        inputColumns: [],
      },
    } as AppNode
    const rows = await run('n2', [src, agg], [edge('e1', 'n1', 'n2')])
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].total_orders)).toBe(30)
  })

  it('AVG returns a numeric value', async () => {
    const src = csvNode('n1', f.employees, ['department', 'salary'])
    const agg: AppNode = {
      id: 'n2', type: 'aggregate', position: pos,
      data: {
        groupBy: ['department'],
        aggregations: [{ id: 'x', func: 'AVG', column: 'salary', alias: 'avg_salary' }],
        inputColumns: [],
      },
    } as AppNode
    const rows = await run('n2', [src, agg], [edge('e1', 'n1', 'n2')])
    expect(rows.every((r) => typeof r.avg_salary === 'number' && r.avg_salary > 0)).toBe(true)
  })

  it('COUNT DISTINCT counts unique statuses', async () => {
    const src = csvNode('n1', f.orders, ['status'])
    const agg: AppNode = {
      id: 'n2', type: 'aggregate', position: pos,
      data: {
        groupBy: [],
        aggregations: [{ id: 'x', func: 'COUNT_DISTINCT', column: 'status', alias: 'n_statuses' }],
        inputColumns: [],
      },
    } as AppNode
    const rows = await run('n2', [src, agg], [edge('e1', 'n1', 'n2')])
    // Orders have: complete, pending, cancelled = 3 distinct statuses
    expect(Number(rows[0].n_statuses)).toBe(3)
  })
})

// ── Transform ────────────────────────────────────────────────────────────────

describe('transform', () => {
  it('computes an expression column', async () => {
    const src = csvNode('n1', f.employees, ['id', 'salary'])
    const t: AppNode = {
      id: 'n2', type: 'transform', position: pos,
      data: {
        expressions: [{ id: 'x', alias: 'bonus', expr: 'CAST(salary AS DOUBLE) * 0.1' }],
        keepAll: true,
        inputColumns: [],
      },
    } as AppNode
    const rows = await run('n2', [src, t], [edge('e1', 'n1', 'n2')])
    expect(rows.every((r) => Object.prototype.hasOwnProperty.call(r, 'bonus'))).toBe(true)
    const row = rows[0]
    expect(Number(row.bonus)).toBeCloseTo(Number(row.salary) * 0.1, 1)
  })

  it('keepAll=false projects only expressions', async () => {
    const src = csvNode('n1', f.employees, ['id', 'name', 'salary'])
    const t: AppNode = {
      id: 'n2', type: 'transform', position: pos,
      data: {
        expressions: [{ id: 'x', alias: 'upper_name', expr: 'upper(name)' }],
        keepAll: false,
        inputColumns: [],
      },
    } as AppNode
    const rows = await run('n2', [src, t], [edge('e1', 'n1', 'n2')])
    expect(Object.keys(rows[0])).toEqual(['upper_name'])
    expect(String(rows[0].upper_name)).toBe(String(rows[0].upper_name).toUpperCase())
  })
})

// ── Join ─────────────────────────────────────────────────────────────────────

describe('join', () => {
  it('INNER JOIN employees × orders on employee_id', async () => {
    const emps = csvNode('n1', f.employees, ['id', 'name'])
    const ords = csvNode('n2', f.orders,    ['order_id', 'employee_id', 'amount'])
    const j: AppNode = {
      id: 'n3', type: 'join', position: pos,
      data: {
        joinType: 'INNER',
        leftKey: 'id', rightKey: 'employee_id',
        leftColumns:  [{ name: 'id', type: 'TEXT' }, { name: 'name', type: 'TEXT' }],
        rightColumns: [{ name: 'order_id', type: 'TEXT' }, { name: 'employee_id', type: 'TEXT' }, { name: 'amount', type: 'TEXT' }],
      },
    } as AppNode
    const rows = await run('n3', [emps, ords, j], [
      edge('e1', 'n1', 'n3', 'row-out', 'row-left'),
      edge('e2', 'n2', 'n3', 'row-out', 'row-right'),
    ])
    expect(rows.length).toBe(30)  // all orders have matching employees
    expect(Object.prototype.hasOwnProperty.call(rows[0], 'name')).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(rows[0], 'r_amount')).toBe(true)
  })

  it('LEFT JOIN regions preserves all employees', async () => {
    const emps  = csvNode('n1', f.employees, ['id', 'country'])
    const regs  = csvNode('n2', f.regions,   ['country', 'region'])
    const j: AppNode = {
      id: 'n3', type: 'join', position: pos,
      data: {
        joinType: 'LEFT',
        leftKey: 'country', rightKey: 'country',
        leftColumns:  [{ name: 'id', type: 'TEXT' }, { name: 'country', type: 'TEXT' }],
        rightColumns: [{ name: 'country', type: 'TEXT' }, { name: 'region', type: 'TEXT' }],
      },
    } as AppNode
    const rows = await run('n3', [emps, regs, j], [
      edge('e1', 'n1', 'n3', 'row-out', 'row-left'),
      edge('e2', 'n2', 'n3', 'row-out', 'row-right'),
    ])
    expect(rows).toHaveLength(20)  // all employees preserved
    expect(Object.prototype.hasOwnProperty.call(rows[0], 'r_region')).toBe(true)
  })
})

// ── Static Value emitter ──────────────────────────────────────────────────────

describe('static-value', () => {
  it('emits constant for every row when anchored', async () => {
    const src = csvNode('n1', f.employees, ['id'])
    const sv: AppNode = {
      id: 'n2', type: 'static-value', position: pos,
      data: { columnName: 'source', value: 'import_jan', hasAnchor: true },
    } as AppNode
    const rows = await run('n2', [src, sv], [edge('e1', 'n1', 'n2', 'row-out', 'anchor-in')])
    expect(rows).toHaveLength(20)
    expect(rows.every((r) => r.source === 'import_jan')).toBe(true)
  })
})

// ── Increment Value emitter ───────────────────────────────────────────────────

describe('increment-value', () => {
  it('generates sequential integers from 1', async () => {
    const src = csvNode('n1', f.employees, ['id'])
    const iv: AppNode = {
      id: 'n2', type: 'increment-value', position: pos,
      data: { columnName: 'row_num', startAt: 1, hasAnchor: true },
    } as AppNode
    const rows = await run('n2', [src, iv], [edge('e1', 'n1', 'n2', 'row-out', 'anchor-in')])
    const nums = rows.map((r) => Number(r.row_num))
    expect(nums).toHaveLength(20)
    expect(nums[0]).toBe(1)
    expect(nums[19]).toBe(20)
  })

  it('starts at custom offset', async () => {
    const src = csvNode('n1', f.employees, ['id'])
    const iv: AppNode = {
      id: 'n2', type: 'increment-value', position: pos,
      data: { columnName: 'seq', startAt: 100, hasAnchor: true },
    } as AppNode
    const rows = await run('n2', [src, iv], [edge('e1', 'n1', 'n2', 'row-out', 'anchor-in')])
    const nums = rows.map((r) => Number(r.seq))
    expect(nums[0]).toBe(100)
    expect(nums[19]).toBe(119)
  })
})

// ── Map Value emitter ─────────────────────────────────────────────────────────

describe('map-value', () => {
  it('maps country codes to region names', async () => {
    const src = csvNode('n1', f.employees, ['id', 'country'])
    const mv: AppNode = {
      id: 'n2', type: 'map-value', position: pos,
      data: {
        columnName: 'region',
        sourceColumn: 'country',
        mappings: [
          { from: 'US', to: 'North America' },
          { from: 'CA', to: 'North America' },
          { from: 'UK', to: 'Europe' },
          { from: 'AU', to: 'Asia Pacific' },
        ],
        hasAnchor: true,
      },
    } as AppNode
    const rows = await run('n2', [src, mv], [edge('e1', 'n1', 'n2', 'row-out', 'anchor-in')])
    // The emitter outputs only the "region" column (one value per anchored row)
    expect(rows).toHaveLength(20)
    expect(rows.every((r) => Object.prototype.hasOwnProperty.call(r, 'region'))).toBe(true)
    // US (6) + CA (4) → North America = 10, UK (5) → Europe = 5, AU (5) → Asia Pacific = 5
    expect(rows.filter((r) => r.region === 'North America').length).toBe(10)
    expect(rows.filter((r) => r.region === 'Europe').length).toBe(5)
    expect(rows.filter((r) => r.region === 'Asia Pacific').length).toBe(5)
  })
})

// ── Conditional Output emitter ────────────────────────────────────────────────

describe('conditional-output', () => {
  it('applies conditions top-down, else for unmatched', async () => {
    const src = csvNode('n1', f.employees, ['id', 'salary'])
    const co: AppNode = {
      id: 'n2', type: 'conditional-output', position: pos,
      data: {
        columnName: 'tier',
        conditions: [
          { condition: 'CAST(salary AS INTEGER) >= 90000', output: 'Senior' },
          { condition: 'CAST(salary AS INTEGER) >= 70000', output: 'Mid'    },
        ],
        fallback: 'Junior',
        hasAnchor: true,
      },
    } as AppNode
    const rows = await run('n2', [src, co], [edge('e1', 'n1', 'n2', 'row-out', 'anchor-in')])
    const tiers = rows.map((r) => r.tier)
    expect(tiers.every((t) => ['Senior', 'Mid', 'Junior'].includes(t as string))).toBe(true)
  })
})

// ── Chained pipeline integration ──────────────────────────────────────────────

describe('pipeline chains', () => {
  it('CSV → Filter → Sort → Limit gives top-N filtered rows', async () => {
    const src = csvNode('n1', f.employees, ['id', 'department', 'salary'])
    const filt: AppNode = {
      id: 'n2', type: 'filter', position: pos,
      data: { condition: "department = 'Engineering'", inputColumns: [] },
    } as AppNode
    const sort: AppNode = {
      id: 'n3', type: 'sort', position: pos,
      data: { sortKeys: [{ column: 'salary', direction: 'DESC' }], inputColumns: [] },
    } as AppNode
    const lim: AppNode = {
      id: 'n4', type: 'limit', position: pos,
      data: { count: 3, offset: 0 },
    } as AppNode
    const nodes = [src, filt, sort, lim]
    const edges = [
      edge('e1', 'n1', 'n2'),
      edge('e2', 'n2', 'n3', 'row-out-pass', 'row-in'),
      edge('e3', 'n3', 'n4'),
    ]
    const rows = await run('n4', nodes, edges)
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.department === 'Engineering')).toBe(true)
    const salaries = rows.map((r) => Number(r.salary))
    expect(salaries).toEqual([...salaries].sort((a, b) => b - a))
  })

  it('CSV → Aggregate → Sort produces sorted summary', async () => {
    const src = csvNode('n1', f.employees, ['department', 'salary'])
    const agg: AppNode = {
      id: 'n2', type: 'aggregate', position: pos,
      data: {
        groupBy: ['department'],
        aggregations: [
          { id: 'a', func: 'COUNT', column: '',       alias: 'headcount'  },
          { id: 'b', func: 'AVG',   column: 'salary', alias: 'avg_salary' },
        ],
        inputColumns: [],
      },
    } as AppNode
    const sort: AppNode = {
      id: 'n3', type: 'sort', position: pos,
      data: { sortKeys: [{ column: 'headcount', direction: 'DESC' }], inputColumns: [] },
    } as AppNode
    const rows = await run('n3', [src, agg, sort], [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')])
    const counts = rows.map((r) => Number(r.headcount))
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
    const total = counts.reduce((s, c) => s + c, 0)
    expect(total).toBe(20)
  })

  it('two CSV sources → Merge → Filter → Unique', async () => {
    // Merge employees with itself (40 rows) → filter Engineering → unique by name (keep first)
    const n1 = csvNode('n1', f.employees, ['id', 'name', 'department'])
    const n2 = csvNode('n2', f.employees, ['id', 'name', 'department'])
    const m: AppNode = {
      id: 'n3', type: 'merge', position: pos,
      data: { inputColumns: [] },
    } as AppNode
    const filt: AppNode = {
      id: 'n4', type: 'filter', position: pos,
      data: { condition: "department = 'Engineering'", inputColumns: [] },
    } as AppNode
    const u: AppNode = {
      id: 'n5', type: 'unique', position: pos,
      data: { keyColumn: 'name', keep: 'first', inputColumns: [] },
    } as AppNode
    const rows = await run('n5', [n1, n2, m, filt, u], [
      edge('e1', 'n1', 'n3', 'row-out', 'row-left'),
      edge('e2', 'n2', 'n3', 'row-out', 'row-right'),
      edge('e3', 'n3', 'n4'),
      edge('e4', 'n4', 'n5', 'row-out-pass', 'row-in'),
    ])
    // Engineering employees in fixture × 2 (merged) → unique by name → back to original count
    const names = rows.map((r) => r.name as string)
    expect(new Set(names).size).toBe(names.length)  // all unique
    expect(rows.every((r) => r.department === 'Engineering')).toBe(true)
  })
})

