/**
 * Unit tests for sqlBuilder.ts — pure SQL string generation, no DuckDB required.
 *
 * Each test builds a minimal mock graph (nodes + edges) and asserts the
 * generated SQL matches the expected string.  We don't execute the SQL here;
 * integration/pipeline.test.ts covers correctness against real data.
 */
import { describe, it, expect } from 'vitest'
import { buildNodeSQL, getNodeOutputColumns } from '../../src/renderer/src/lib/sqlBuilder'
import type { AppNode, AppEdge } from '../../src/renderer/src/lib/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

const pos = { x: 0, y: 0 }

function csvNode(id: string, filePath = '/data/test.csv', cols = ['a', 'b']): AppNode {
  return {
    id, type: 'csv-input', position: pos,
    data: {
      fileName: 'test.csv', filePath,
      columns: cols.map((n) => ({ name: n, type: 'TEXT' })),
    },
  } as AppNode
}

function edge(id: string, source: string, target: string, sh = 'row-out', th = 'row-in'): AppEdge {
  return { id, source, target, sourceHandle: sh, targetHandle: th }
}

// ── csv-input ─────────────────────────────────────────────────────────────────

describe('csv-input', () => {
  it('generates read_csv_auto for a valid file', () => {
    const n = csvNode('n1', '/data/sales.csv')
    const sql = buildNodeSQL('n1', [n], [])
    expect(sql).toBe("SELECT * FROM read_csv_auto('/data/sales.csv')")
  })

  it('returns null when filePath is empty', () => {
    const n = csvNode('n1', '')
    expect(buildNodeSQL('n1', [n], [])).toBeNull()
  })

  it('escapes single quotes in file path', () => {
    const n = csvNode('n1', "/data/mike's file.csv")
    expect(buildNodeSQL('n1', [n], [])).toContain("mike''s file.csv")
  })
})

// ── getNodeOutputColumns ──────────────────────────────────────────────────────

describe('getNodeOutputColumns – csv-input', () => {
  it('returns columns from node data', () => {
    const n = csvNode('n1', '/f.csv', ['id', 'name', 'amount'])
    const cols = getNodeOutputColumns('n1', [n], [])
    expect(cols.map((c) => c.name)).toEqual(['id', 'name', 'amount'])
  })
})

// ── transform ────────────────────────────────────────────────────────────────

describe('transform', () => {
  const src = csvNode('n1')
  const e1  = edge('e1', 'n1', 'n2')

  it('passes through with no expressions', () => {
    const t: AppNode = {
      id: 'n2', type: 'transform', position: pos,
      data: { expressions: [], keepAll: true, inputColumns: [] },
    } as AppNode
    expect(buildNodeSQL('n2', [src, t], [e1])).toContain('SELECT * FROM')
  })

  it('appends expressions when keepAll=true', () => {
    const t: AppNode = {
      id: 'n2', type: 'transform', position: pos,
      data: {
        expressions: [{ id: 'x', alias: 'upper_a', expr: 'upper(a)' }],
        keepAll: true,
        inputColumns: [],
      },
    } as AppNode
    const sql = buildNodeSQL('n2', [src, t], [e1])
    expect(sql).toContain('*, (upper(a)) AS "upper_a"')
  })

  it('projects only expressions when keepAll=false', () => {
    const t: AppNode = {
      id: 'n2', type: 'transform', position: pos,
      data: {
        expressions: [{ id: 'x', alias: 'rev', expr: 'amount * 1.1' }],
        keepAll: false,
        inputColumns: [],
      },
    } as AppNode
    const sql = buildNodeSQL('n2', [src, t], [e1])
    expect(sql).toContain('(amount * 1.1) AS "rev"')
    expect(sql).not.toContain('*,')
  })

  it('returns null when no input edge', () => {
    const t: AppNode = {
      id: 'n2', type: 'transform', position: pos,
      data: { expressions: [], keepAll: true, inputColumns: [] },
    } as AppNode
    expect(buildNodeSQL('n2', [src, t], [])).toBeNull()
  })
})

// ── join ─────────────────────────────────────────────────────────────────────

describe('join', () => {
  const left  = csvNode('n1', '/left.csv',  ['id', 'name'])
  const right = csvNode('n2', '/right.csv', ['id', 'dept'])

  const join: AppNode = {
    id: 'n3', type: 'join', position: pos,
    data: {
      joinType: 'INNER',
      leftKey: 'id', rightKey: 'id',
      leftColumns:  [{ name: 'id', type: 'TEXT' }, { name: 'name', type: 'TEXT' }],
      rightColumns: [{ name: 'id', type: 'TEXT' }, { name: 'dept', type: 'TEXT' }],
    },
  } as AppNode

  const eL = edge('e1', 'n1', 'n3', 'row-out', 'row-left')
  const eR = edge('e2', 'n2', 'n3', 'row-out', 'row-right')

  it('generates INNER JOIN with key', () => {
    const sql = buildNodeSQL('n3', [left, right, join], [eL, eR])
    expect(sql).toContain('INNER JOIN')
    expect(sql).toContain('ON __l."id" = __r."id"')
  })

  it('prefixes right columns with r_', () => {
    const sql = buildNodeSQL('n3', [left, right, join], [eL, eR])
    expect(sql).toContain('r_id')
    expect(sql).toContain('r_dept')
  })

  it('falls back to CROSS JOIN when keys are empty', () => {
    const noKey: AppNode = {
      id: 'n3', type: 'join', position: pos,
      data: { joinType: 'LEFT', leftKey: '', rightKey: '', leftColumns: [], rightColumns: [] },
    } as AppNode
    const sql = buildNodeSQL('n3', [left, right, noKey], [eL, eR])
    expect(sql).toContain('CROSS JOIN')
  })

  it('returns null when left edge missing', () => {
    expect(buildNodeSQL('n3', [left, right, join], [eR])).toBeNull()
  })

  it('supports all join types', () => {
    for (const jt of ['LEFT', 'RIGHT', 'FULL'] as const) {
      const jNode: AppNode = {
        id: 'n3', type: 'join', position: pos,
        data: { joinType: jt, leftKey: 'id', rightKey: 'id', leftColumns: [], rightColumns: [] },
      } as AppNode
      expect(buildNodeSQL('n3', [left, right, jNode], [eL, eR])).toContain(jt + ' JOIN')
    }
  })
})

// ── merge ────────────────────────────────────────────────────────────────────

describe('merge', () => {
  const n1 = csvNode('n1', '/a.csv')
  const n2 = csvNode('n2', '/b.csv')
  const m: AppNode = {
    id: 'n3', type: 'merge', position: pos,
    data: { inputColumns: [] },
  } as AppNode
  const eL = edge('e1', 'n1', 'n3', 'row-out', 'row-left')
  const eR = edge('e2', 'n2', 'n3', 'row-out', 'row-right')

  it('generates UNION ALL', () => {
    expect(buildNodeSQL('n3', [n1, n2, m], [eL, eR])).toContain('UNION ALL')
  })

  it('returns null when one side missing', () => {
    expect(buildNodeSQL('n3', [n1, n2, m], [eL])).toBeNull()
  })
})

// ── filter ───────────────────────────────────────────────────────────────────

describe('filter', () => {
  const src = csvNode('n1')
  const f: AppNode = {
    id: 'n2', type: 'filter', position: pos,
    data: { condition: "status = 'active'", inputColumns: [] },
  } as AppNode
  const e1 = edge('e1', 'n1', 'n2')

  it('generates WHERE for pass branch', () => {
    const sql = buildNodeSQL('n2', [src, f], [e1], 'row-out-pass')
    expect(sql).toContain("WHERE (status = 'active')")
    expect(sql).not.toContain('NOT')
  })

  it('generates WHERE NOT for fail branch', () => {
    const sql = buildNodeSQL('n2', [src, f], [e1], 'row-out-fail')
    expect(sql).toContain("WHERE NOT (status = 'active')")
  })

  it('defaults to pass when no outputHandle supplied', () => {
    const sql = buildNodeSQL('n2', [src, f], [e1])
    expect(sql).toContain("WHERE (status = 'active')")
  })

  it('passes through when condition is empty', () => {
    const empty: AppNode = {
      id: 'n2', type: 'filter', position: pos,
      data: { condition: '', inputColumns: [] },
    } as AppNode
    expect(buildNodeSQL('n2', [src, empty], [e1])).not.toContain('WHERE')
  })
})

// ── unique ────────────────────────────────────────────────────────────────────

describe('unique', () => {
  const src = csvNode('n1')
  const e1  = edge('e1', 'n1', 'n2')

  it('generates QUALIFY with ASC for first', () => {
    const u: AppNode = {
      id: 'n2', type: 'unique', position: pos,
      data: { keyColumn: 'category', keep: 'first', inputColumns: [] },
    } as AppNode
    const sql = buildNodeSQL('n2', [src, u], [e1])
    expect(sql).toContain('PARTITION BY "category"')
    expect(sql).toContain('ORDER BY __seq ASC')
  })

  it('generates QUALIFY with DESC for last', () => {
    const u: AppNode = {
      id: 'n2', type: 'unique', position: pos,
      data: { keyColumn: 'category', keep: 'last', inputColumns: [] },
    } as AppNode
    const sql = buildNodeSQL('n2', [src, u], [e1])
    expect(sql).toContain('ORDER BY __seq DESC')
  })

  it('returns null when keyColumn is empty', () => {
    const u: AppNode = {
      id: 'n2', type: 'unique', position: pos,
      data: { keyColumn: '', keep: 'first', inputColumns: [] },
    } as AppNode
    expect(buildNodeSQL('n2', [src, u], [e1])).toBeNull()
  })

  it('uses EXCLUDE __seq to hide the internal helper column', () => {
    const u: AppNode = {
      id: 'n2', type: 'unique', position: pos,
      data: { keyColumn: 'id', keep: 'first', inputColumns: [] },
    } as AppNode
    expect(buildNodeSQL('n2', [src, u], [e1])).toContain('EXCLUDE __seq')
  })
})

// ── sort ──────────────────────────────────────────────────────────────────────

describe('sort', () => {
  const src = csvNode('n1')
  const e1  = edge('e1', 'n1', 'n2')

  it('generates ORDER BY for a single key', () => {
    const s: AppNode = {
      id: 'n2', type: 'sort', position: pos,
      data: { sortKeys: [{ column: 'salary', direction: 'DESC' }], inputColumns: [] },
    } as AppNode
    expect(buildNodeSQL('n2', [src, s], [e1])).toContain('ORDER BY "salary" DESC')
  })

  it('generates ORDER BY for multiple keys', () => {
    const s: AppNode = {
      id: 'n2', type: 'sort', position: pos,
      data: {
        sortKeys: [
          { column: 'country', direction: 'ASC' },
          { column: 'salary',  direction: 'DESC' },
        ],
        inputColumns: [],
      },
    } as AppNode
    const sql = buildNodeSQL('n2', [src, s], [e1])
    expect(sql).toContain('"country" ASC, "salary" DESC')
  })

  it('skips keys with empty column', () => {
    const s: AppNode = {
      id: 'n2', type: 'sort', position: pos,
      data: {
        sortKeys: [{ column: '', direction: 'ASC' }, { column: 'name', direction: 'ASC' }],
        inputColumns: [],
      },
    } as AppNode
    const sql = buildNodeSQL('n2', [src, s], [e1])
    expect(sql).toContain('"name" ASC')
    expect(sql).not.toContain('"" ASC')
  })

  it('passes through without ORDER BY when all keys empty', () => {
    const s: AppNode = {
      id: 'n2', type: 'sort', position: pos,
      data: { sortKeys: [{ column: '', direction: 'ASC' }], inputColumns: [] },
    } as AppNode
    expect(buildNodeSQL('n2', [src, s], [e1])).not.toContain('ORDER BY')
  })
})

// ── limit ─────────────────────────────────────────────────────────────────────

describe('limit', () => {
  const src = csvNode('n1')
  const e1  = edge('e1', 'n1', 'n2')

  it('generates LIMIT clause', () => {
    const l: AppNode = {
      id: 'n2', type: 'limit', position: pos,
      data: { count: 10, offset: 0 },
    } as AppNode
    expect(buildNodeSQL('n2', [src, l], [e1])).toContain('LIMIT 10')
  })

  it('omits OFFSET when zero', () => {
    const l: AppNode = {
      id: 'n2', type: 'limit', position: pos,
      data: { count: 5, offset: 0 },
    } as AppNode
    expect(buildNodeSQL('n2', [src, l], [e1])).not.toContain('OFFSET')
  })

  it('includes OFFSET when > 0', () => {
    const l: AppNode = {
      id: 'n2', type: 'limit', position: pos,
      data: { count: 10, offset: 20 },
    } as AppNode
    expect(buildNodeSQL('n2', [src, l], [e1])).toContain('LIMIT 10 OFFSET 20')
  })

  it('clamps count to minimum 1', () => {
    const l: AppNode = {
      id: 'n2', type: 'limit', position: pos,
      data: { count: -5, offset: 0 },
    } as AppNode
    expect(buildNodeSQL('n2', [src, l], [e1])).toContain('LIMIT 1')
  })
})

// ── aggregate ────────────────────────────────────────────────────────────────

describe('aggregate', () => {
  const src = csvNode('n1', '/f.csv', ['dept', 'salary', 'country'])
  const e1  = edge('e1', 'n1', 'n2')

  it('generates GROUP BY with COUNT(*)', () => {
    const a: AppNode = {
      id: 'n2', type: 'aggregate', position: pos,
      data: {
        groupBy: ['dept'],
        aggregations: [{ id: 'x', func: 'COUNT', column: '', alias: 'headcount' }],
        inputColumns: [],
      },
    } as AppNode
    const sql = buildNodeSQL('n2', [src, a], [e1])
    expect(sql).toContain('"dept"')
    expect(sql).toContain('COUNT(*) AS "headcount"')
    expect(sql).toContain('GROUP BY "dept"')
  })

  it('generates SUM aggregation', () => {
    const a: AppNode = {
      id: 'n2', type: 'aggregate', position: pos,
      data: {
        groupBy: ['country'],
        aggregations: [{ id: 'x', func: 'SUM', column: 'salary', alias: 'total_salary' }],
        inputColumns: [],
      },
    } as AppNode
    expect(buildNodeSQL('n2', [src, a], [e1])).toContain('SUM("salary") AS "total_salary"')
  })

  it('generates COUNT DISTINCT', () => {
    const a: AppNode = {
      id: 'n2', type: 'aggregate', position: pos,
      data: {
        groupBy: [],
        aggregations: [{ id: 'x', func: 'COUNT_DISTINCT', column: 'dept', alias: 'n_depts' }],
        inputColumns: [],
      },
    } as AppNode
    expect(buildNodeSQL('n2', [src, a], [e1])).toContain('COUNT(DISTINCT "dept") AS "n_depts"')
  })

  it('skips aggregations without an alias', () => {
    const a: AppNode = {
      id: 'n2', type: 'aggregate', position: pos,
      data: {
        groupBy: [],
        aggregations: [
          { id: 'x', func: 'COUNT', column: '', alias: '' },
          { id: 'y', func: 'SUM',   column: 'salary', alias: 'total' },
        ],
        inputColumns: [],
      },
    } as AppNode
    const sql = buildNodeSQL('n2', [src, a], [e1])
    expect(sql).not.toContain('COUNT(*) AS ""')
    expect(sql).toContain('SUM("salary") AS "total"')
  })

  it('omits GROUP BY clause when no groupBy columns', () => {
    const a: AppNode = {
      id: 'n2', type: 'aggregate', position: pos,
      data: {
        groupBy: [],
        aggregations: [{ id: 'x', func: 'COUNT', column: '', alias: 'total' }],
        inputColumns: [],
      },
    } as AppNode
    expect(buildNodeSQL('n2', [src, a], [e1])).not.toContain('GROUP BY')
  })

  it('supports multiple agg functions in one node', () => {
    const a: AppNode = {
      id: 'n2', type: 'aggregate', position: pos,
      data: {
        groupBy: ['dept'],
        aggregations: [
          { id: 'a', func: 'COUNT', column: '',       alias: 'cnt' },
          { id: 'b', func: 'AVG',   column: 'salary', alias: 'avg_sal' },
          { id: 'c', func: 'MAX',   column: 'salary', alias: 'max_sal' },
          { id: 'd', func: 'MIN',   column: 'salary', alias: 'min_sal' },
        ],
        inputColumns: [],
      },
    } as AppNode
    const sql = buildNodeSQL('n2', [src, a], [e1])!
    expect(sql).toContain('COUNT(*) AS "cnt"')
    expect(sql).toContain('AVG("salary") AS "avg_sal"')
    expect(sql).toContain('MAX("salary") AS "max_sal"')
    expect(sql).toContain('MIN("salary") AS "min_sal"')
  })
})

// ── static-value emitter ──────────────────────────────────────────────────────

describe('static-value', () => {
  it('generates constant expression without anchor', () => {
    const n: AppNode = {
      id: 'n1', type: 'static-value', position: pos,
      data: { columnName: 'source', value: 'import_jan', hasAnchor: false },
    } as AppNode
    expect(buildNodeSQL('n1', [n], [])).toContain("'import_jan'")
  })

  it('escapes single quotes in value', () => {
    const n: AppNode = {
      id: 'n1', type: 'static-value', position: pos,
      data: { columnName: 'label', value: "it's here", hasAnchor: false },
    } as AppNode
    expect(buildNodeSQL('n1', [n], [])).toContain("'it''s here'")
  })

  it('wraps in SELECT FROM anchor when anchor edge present', () => {
    const src = csvNode('n1')
    const sv: AppNode = {
      id: 'n2', type: 'static-value', position: pos,
      data: { columnName: 'tag', value: 'x', hasAnchor: true },
    } as AppNode
    const e = edge('e1', 'n1', 'n2', 'row-out', 'anchor-in')
    const sql = buildNodeSQL('n2', [src, sv], [e])
    expect(sql).toContain('FROM')
    expect(sql).toContain('__anchor')
  })
})

// ── increment-value emitter ───────────────────────────────────────────────────

describe('increment-value', () => {
  it('generates ROW_NUMBER() OVER () for startAt=1', () => {
    const n: AppNode = {
      id: 'n1', type: 'increment-value', position: pos,
      data: { columnName: 'idx', startAt: 1, hasAnchor: false },
    } as AppNode
    expect(buildNodeSQL('n1', [n], [])).toContain('ROW_NUMBER() OVER ()')
  })

  it('offsets ROW_NUMBER for startAt > 1', () => {
    const n: AppNode = {
      id: 'n1', type: 'increment-value', position: pos,
      data: { columnName: 'idx', startAt: 5, hasAnchor: false },
    } as AppNode
    expect(buildNodeSQL('n1', [n], [])).toContain('+ 4')
  })
})

// ── map-value emitter ─────────────────────────────────────────────────────────

describe('map-value', () => {
  it('generates CASE WHEN expression', () => {
    const n: AppNode = {
      id: 'n1', type: 'map-value', position: pos,
      data: {
        columnName: 'region',
        sourceColumn: 'country',
        mappings: [{ from: 'US', to: 'North America' }, { from: 'UK', to: 'Europe' }],
        hasAnchor: false,
      },
    } as AppNode
    const sql = buildNodeSQL('n1', [n], [])!
    expect(sql).toContain('CASE "country"')
    expect(sql).toContain("WHEN 'US' THEN 'North America'")
    expect(sql).toContain("WHEN 'UK' THEN 'Europe'")
    expect(sql).toContain('ELSE NULL')
  })

  it('returns null when no sourceColumn', () => {
    const n: AppNode = {
      id: 'n1', type: 'map-value', position: pos,
      data: { columnName: 'out', sourceColumn: '', mappings: [{ from: 'a', to: 'b' }], hasAnchor: false },
    } as AppNode
    expect(buildNodeSQL('n1', [n], [])).toBeNull()
  })

  it('skips mappings where from is empty', () => {
    const n: AppNode = {
      id: 'n1', type: 'map-value', position: pos,
      data: {
        columnName: 'out',
        sourceColumn: 'col',
        mappings: [{ from: '', to: 'x' }, { from: 'A', to: 'B' }],
        hasAnchor: false,
      },
    } as AppNode
    const sql = buildNodeSQL('n1', [n], [])!
    expect(sql).toContain("WHEN 'A' THEN 'B'")
    expect(sql).not.toContain("WHEN '' THEN")
  })
})

// ── conditional-output emitter ────────────────────────────────────────────────

describe('conditional-output', () => {
  it('generates CASE WHEN branches', () => {
    const n: AppNode = {
      id: 'n1', type: 'conditional-output', position: pos,
      data: {
        columnName: 'tier',
        conditions: [
          { condition: 'salary > 90000', output: 'Senior' },
          { condition: 'salary > 70000', output: 'Mid'    },
        ],
        fallback: 'Junior',
        hasAnchor: false,
      },
    } as AppNode
    const sql = buildNodeSQL('n1', [n], [])!
    expect(sql).toContain('WHEN (salary > 90000) THEN')
    expect(sql).toContain("'Senior'")
    expect(sql).toContain("ELSE 'Junior'")
  })

  it('uses NULL as fallback when fallback is empty', () => {
    const n: AppNode = {
      id: 'n1', type: 'conditional-output', position: pos,
      data: {
        columnName: 'tier',
        conditions: [{ condition: 'x > 0', output: 'pos' }],
        fallback: '',
        hasAnchor: false,
      },
    } as AppNode
    expect(buildNodeSQL('n1', [n], [])).toContain('ELSE NULL')
  })

  it('returns null when no conditions provided', () => {
    const n: AppNode = {
      id: 'n1', type: 'conditional-output', position: pos,
      data: { columnName: 'tier', conditions: [], fallback: '', hasAnchor: false },
    } as AppNode
    expect(buildNodeSQL('n1', [n], [])).toBeNull()
  })
})

// ── destination ───────────────────────────────────────────────────────────────

describe('destination', () => {
  const src = csvNode('n1', '/f.csv', ['id', 'name', 'country'])
  const e1  = edge('e1', 'n1', 'n2')

  it('passes SELECT * when colMap is empty', () => {
    const d: AppNode = {
      id: 'n2', type: 'destination', position: pos,
      data: { label: 'Out', inputColumns: [], colMap: [] },
    } as AppNode
    expect(buildNodeSQL('n2', [src, d], [e1])).toContain('SELECT *')
  })

  it('projects only included columns', () => {
    const d: AppNode = {
      id: 'n2', type: 'destination', position: pos,
      data: {
        label: 'Out',
        inputColumns: [],
        colMap: [
          { sourceCol: 'id',      destCol: 'id',      included: true  },
          { sourceCol: 'name',    destCol: 'name',    included: true  },
          { sourceCol: 'country', destCol: 'country', included: false },
        ],
      },
    } as AppNode
    const sql = buildNodeSQL('n2', [src, d], [e1])!
    expect(sql).toContain('"id"')
    expect(sql).toContain('"name"')
    expect(sql).not.toContain('"country"')
  })

  it('renames columns via destCol', () => {
    const d: AppNode = {
      id: 'n2', type: 'destination', position: pos,
      data: {
        label: 'Out',
        inputColumns: [],
        colMap: [{ sourceCol: 'id', destCol: 'employee_id', included: true }],
      },
    } as AppNode
    expect(buildNodeSQL('n2', [src, d], [e1])).toContain('"id" AS "employee_id"')
  })

  it('substitutes static-value emitter expression', () => {
    const sv: AppNode = {
      id: 'n3', type: 'static-value', position: pos,
      data: { columnName: 'country', value: 'US', hasAnchor: false },
    } as AppNode
    const d: AppNode = {
      id: 'n2', type: 'destination', position: pos,
      data: {
        label: 'Out',
        inputColumns: [],
        colMap: [{ sourceCol: 'country', destCol: 'country', included: true }],
      },
    } as AppNode
    const colEdge = edge('e2', 'n3', 'n2', 'col-out', 'col-in-country')
    const sql = buildNodeSQL('n2', [src, sv, d], [e1, colEdge])!
    // The emitter expression replaces the source column reference; alias still appears as dest name
    expect(sql).toContain("('US') AS \"country\"")
  })
})

// ── chained pipeline ──────────────────────────────────────────────────────────

describe('chained pipeline', () => {
  it('CSV → Sort → Limit produces nested SQL', () => {
    const csv: AppNode = {
      id: 'n1', type: 'csv-input', position: pos,
      data: { fileName: 'f.csv', filePath: '/f.csv', columns: [{ name: 'salary', type: 'INTEGER' }] },
    } as AppNode
    const sort: AppNode = {
      id: 'n2', type: 'sort', position: pos,
      data: { sortKeys: [{ column: 'salary', direction: 'DESC' }], inputColumns: [] },
    } as AppNode
    const lim: AppNode = {
      id: 'n3', type: 'limit', position: pos,
      data: { count: 5, offset: 0 },
    } as AppNode

    const nodes = [csv, sort, lim]
    const edges = [
      edge('e1', 'n1', 'n2'),
      edge('e2', 'n2', 'n3'),
    ]

    const sql = buildNodeSQL('n3', nodes, edges)!
    expect(sql).toContain('ORDER BY "salary" DESC')
    expect(sql).toContain('LIMIT 5')
    // SQL is nested — outer wraps the sorted subquery
    expect(sql.indexOf('ORDER BY')).toBeLessThan(sql.indexOf('LIMIT'))
  })

  it('CSV → Filter → Aggregate produces correct SQL', () => {
    const csv: AppNode = {
      id: 'n1', type: 'csv-input', position: pos,
      data: { fileName: 'f.csv', filePath: '/f.csv', columns: [{ name: 'dept', type: 'TEXT' }, { name: 'salary', type: 'INTEGER' }] },
    } as AppNode
    const filt: AppNode = {
      id: 'n2', type: 'filter', position: pos,
      data: { condition: 'salary > 70000', inputColumns: [] },
    } as AppNode
    const agg: AppNode = {
      id: 'n3', type: 'aggregate', position: pos,
      data: {
        groupBy: ['dept'],
        aggregations: [{ id: 'x', func: 'COUNT', column: '', alias: 'cnt' }],
        inputColumns: [],
      },
    } as AppNode

    // Filter outputs via row-out-pass (the pass branch); sourceHandle must match
    const sql = buildNodeSQL('n3', [csv, filt, agg], [
      edge('e1', 'n1', 'n2'),
      edge('e2', 'n2', 'n3', 'row-out-pass', 'row-in'),
    ])!
    expect(sql).toContain('WHERE (salary > 70000)')
    expect(sql).toContain('GROUP BY "dept"')
    expect(sql).toContain('COUNT(*) AS "cnt"')
  })
})

// ── getNodeOutputColumns for new nodes ────────────────────────────────────────

describe('getNodeOutputColumns', () => {
  it('sort returns upstream columns unchanged', () => {
    const src  = csvNode('n1', '/f.csv', ['x', 'y'])
    const sort: AppNode = {
      id: 'n2', type: 'sort', position: pos,
      data: { sortKeys: [], inputColumns: [{ name: 'x', type: 'TEXT' }, { name: 'y', type: 'TEXT' }] },
    } as AppNode
    const cols = getNodeOutputColumns('n2', [src, sort], [edge('e1', 'n1', 'n2')])
    expect(cols.map((c) => c.name)).toEqual(['x', 'y'])
  })

  it('aggregate returns groupBy + aggregation aliases', () => {
    const src = csvNode('n1', '/f.csv', ['dept', 'salary'])
    const agg: AppNode = {
      id: 'n2', type: 'aggregate', position: pos,
      data: {
        groupBy: ['dept'],
        aggregations: [{ id: 'x', func: 'COUNT', column: '', alias: 'cnt' }],
        inputColumns: [{ name: 'dept', type: 'TEXT' }, { name: 'salary', type: 'INTEGER' }],
      },
    } as AppNode
    const cols = getNodeOutputColumns('n2', [src, agg], [edge('e1', 'n1', 'n2')])
    expect(cols.map((c) => c.name)).toEqual(['dept', 'cnt'])
  })

  it('limit returns upstream columns', () => {
    const src = csvNode('n1', '/f.csv', ['a', 'b', 'c'])
    const lim: AppNode = {
      id: 'n2', type: 'limit', position: pos,
      data: { count: 10, offset: 0 },
    } as AppNode
    const cols = getNodeOutputColumns('n2', [src, lim], [edge('e1', 'n1', 'n2')])
    expect(cols.map((c) => c.name)).toEqual(['a', 'b', 'c'])
  })
})
