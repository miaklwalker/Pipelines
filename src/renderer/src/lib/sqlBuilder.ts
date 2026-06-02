import type {
  AppNode, AppEdge,
  CSVNodeData, JoinNodeData, TransformNodeData, DestinationNodeData, CSVOutputNodeData,
  MergeNodeData, FilterNodeData, StaticValueData, IncrementValueData,
  UniqueNodeData, MapValueData, ConditionalOutputData,
  SortNodeData, LimitNodeData, AggregateNodeData,
  ReadTableNodeData, ReadTableCachedNodeData, WriteTableNodeData,
  BrowseSchemaNodeData, JoinColSelection,
  ColumnInfo,
} from './types'

function escapePath(p: string): string {
  return p.replace(/'/g, "''")
}

/**
 * If `nodeId` is an emitter node (static-value or increment-value), return the
 * SQL expression it emits (no FROM clause — just the scalar expression).
 * Returns null for non-emitter nodes.
 */
function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

function emitterExpression(nodeId: string, nodes: AppNode[]): string | null {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return null

  if (node.type === 'static-value') {
    const d = node.data as StaticValueData
    return sqlStr(d.value ?? '')
  }

  if (node.type === 'increment-value') {
    const d = node.data as IncrementValueData
    const start = typeof d.startAt === 'number' ? d.startAt : 1
    return start === 1
      ? `ROW_NUMBER() OVER ()`
      : `ROW_NUMBER() OVER () + ${start - 1}`
  }

  if (node.type === 'map-value') {
    const d = node.data as MapValueData
    if (!d.sourceColumn || !d.mappings?.length) return null
    const cases = d.mappings
      .filter((m) => m.from !== '')
      .map((m) => `WHEN ${sqlStr(m.from)} THEN ${sqlStr(m.to)}`)
      .join(' ')
    return cases ? `CASE "${d.sourceColumn}" ${cases} ELSE NULL END` : null
  }

  if (node.type === 'conditional-output') {
    const d = node.data as ConditionalOutputData
    const branches = (d.conditions ?? []).filter((c) => c.condition.trim())
    if (!branches.length) return null
    const cases = branches.map((c) => `WHEN (${c.condition}) THEN ${sqlStr(c.output)}`).join(' ')
    const fallback = d.fallback ? sqlStr(d.fallback) : 'NULL'
    return `CASE ${cases} ELSE ${fallback} END`
  }

  return null
}

/**
 * Build the SELECT clause for a Join node, respecting any column selection.
 * Falls back to `__l.*, __r."x" AS "r_x"` when no selection is defined.
 */
function buildJoinSelect(d: JoinNodeData): string {
  const sel = (d.columnSelection ?? []).filter((s) => s.included)

  if (sel.length > 0) {
    const parts = sel.map((s: JoinColSelection) => {
      const tbl = s.side === 'left' ? '__l' : '__r'
      // Only emit alias if it differs from the bare column name
      const needsAlias = s.alias && s.alias !== s.name
      return needsAlias
        ? `${tbl}."${s.name}" AS "${s.alias}"`
        : `${tbl}."${s.name}"`
    })
    return parts.join(', ')
  }

  // Default: left.*, right cols with r_ prefix
  const rightCols = (d.rightColumns ?? [])
    .map((c) => `__r."${c.name}" AS "r_${c.name}"`)
    .join(', ')
  return rightCols ? `__l.*, ${rightCols}` : '__l.*, __r.*'
}

/**
 * Build the SQL query that produces the output of `nodeId`.
 *
 * `outputHandle` is the sourceHandle the CALLER connected from.
 * Only matters for Filter (determines pass vs fail branch).
 */
export function buildNodeSQL(
  nodeId: string,
  nodes: AppNode[],
  edges: AppEdge[],
  outputHandle?: string
): string | null {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return null

  switch (node.type) {
    case 'csv-input': {
      const d = node.data as CSVNodeData
      if (!d.filePath) return null
      return `SELECT * FROM read_csv_auto('${escapePath(d.filePath)}')`
    }

    case 'join': {
      const d = node.data as JoinNodeData
      const leftEdge  = edges.find((e) => e.target === nodeId && e.targetHandle === 'row-left')
      const rightEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'row-right')
      if (!leftEdge || !rightEdge) return null

      const leftSQL  = buildNodeSQL(leftEdge.source, nodes, edges, leftEdge.sourceHandle ?? undefined)
      const rightSQL = buildNodeSQL(rightEdge.source, nodes, edges, rightEdge.sourceHandle ?? undefined)
      if (!leftSQL || !rightSQL) return null

      if (!d.leftKey || !d.rightKey) {
        return `SELECT * FROM (${leftSQL}) __l CROSS JOIN (${rightSQL}) __r`
      }

      // Build SELECT clause from columnSelection if available, otherwise default to all cols
      const selectClause = buildJoinSelect(d)

      return (
        `SELECT ${selectClause} FROM (${leftSQL}) __l ` +
        `${d.joinType} JOIN (${rightSQL}) __r ` +
        `ON __l."${d.leftKey}" = __r."${d.rightKey}"`
      )
    }

    case 'transform': {
      const d = node.data as TransformNodeData
      const inputEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'row-in')
      if (!inputEdge) return null
      const inputSQL = buildNodeSQL(inputEdge.source, nodes, edges, inputEdge.sourceHandle ?? undefined)
      if (!inputSQL) return null

      if (!d.expressions?.length) return `SELECT * FROM (${inputSQL}) __t`
      const exprParts = d.expressions
        .filter((e) => e.expr.trim())
        .map((e) => `(${e.expr}) AS "${e.alias || 'col_' + e.id}"`)
      if (!exprParts.length) return `SELECT * FROM (${inputSQL}) __t`

      const selectClause = d.keepAll ? `*, ${exprParts.join(', ')}` : exprParts.join(', ')
      return `SELECT ${selectClause} FROM (${inputSQL}) __t`
    }

    case 'destination': {
      const d = node.data as DestinationNodeData
      const included = (d.colMap ?? []).filter(m => m.included !== false && !m.sourceCol)
      if (!included.length) return null

      // Find an anchor row source — either through an emitter's anchor-in, or directly from
      // a data node wired to a col-in handle (e.g. read-table col-out-{name})
      let anchorSQL: string | null = null
      for (const m of included) {
        if (!m.destCol) continue
        const colInEdge = edges.find(e => e.target === nodeId && e.targetHandle === `col-in-custom-${m.destCol}`)
        if (!colInEdge) continue
        // Path 1: emitter anchored to a row source
        const anchorEdge = edges.find(e => e.target === colInEdge.source && e.targetHandle === 'anchor-in')
        if (anchorEdge) {
          anchorSQL = buildNodeSQL(anchorEdge.source, nodes, edges, anchorEdge.sourceHandle ?? undefined)
          if (anchorSQL) break
        }
        // Path 2: data node connected directly via col-out — use that node's full row output
        const srcHandle = colInEdge.sourceHandle ?? ''
        if (srcHandle.startsWith('col-out-')) {
          anchorSQL = buildNodeSQL(colInEdge.source, nodes, edges)
          if (anchorSQL) break
        }
      }

      const cols = included.flatMap((m) => {
        if (!m.destCol) return []
        const colInEdge = edges.find(e => e.target === nodeId && e.targetHandle === `col-in-custom-${m.destCol}`)
        if (colInEdge) {
          // Emitter: use its scalar expression
          const expr = emitterExpression(colInEdge.source, nodes)
          if (expr !== null) return [`(${expr}) AS "${m.destCol}"`]
          // Data node col-out: reference the column by name from the anchor
          const srcHandle = colInEdge.sourceHandle ?? ''
          if (srcHandle.startsWith('col-out-')) {
            const srcCol = srcHandle.slice('col-out-'.length)
            return [`"${srcCol}" AS "${m.destCol}"`]
          }
        }
        // Fall back to typed SQL expression
        const expr = m.customExpr?.trim()
        if (!expr) return []
        return [`(${expr}) AS "${m.destCol}"`]
      })
      if (!cols.length) return null
      return anchorSQL
        ? `SELECT ${cols.join(', ')} FROM (${anchorSQL}) __dest`
        : `SELECT ${cols.join(', ')}`
    }

    case 'csv-output': {
      const inputEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'row-in')
      if (!inputEdge) return null
      return buildNodeSQL(inputEdge.source, nodes, edges, inputEdge.sourceHandle ?? undefined)
    }

    case 'merge': {
      const leftEdge  = edges.find((e) => e.target === nodeId && e.targetHandle === 'row-left')
      const rightEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'row-right')
      if (!leftEdge || !rightEdge) return null
      const leftSQL  = buildNodeSQL(leftEdge.source, nodes, edges, leftEdge.sourceHandle ?? undefined)
      const rightSQL = buildNodeSQL(rightEdge.source, nodes, edges, rightEdge.sourceHandle ?? undefined)
      if (!leftSQL || !rightSQL) return null
      return `SELECT * FROM (${leftSQL}) UNION ALL SELECT * FROM (${rightSQL})`
    }

    case 'filter': {
      const d = node.data as FilterNodeData
      const inputEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'row-in')
      if (!inputEdge) return null
      const inputSQL = buildNodeSQL(inputEdge.source, nodes, edges, inputEdge.sourceHandle ?? undefined)
      if (!inputSQL) return null

      const condition = d.condition?.trim()
      if (!condition) return `SELECT * FROM (${inputSQL}) __filter`

      const isPass = !outputHandle
        || outputHandle === 'row-out-pass'
        || outputHandle.startsWith('col-out-pass-')

      const whereClause = isPass ? `(${condition})` : `NOT (${condition})`

      const valEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'val-in')
      if (valEdge) {
        const valSQL = buildNodeSQL(valEdge.source, nodes, edges, valEdge.sourceHandle ?? undefined)
        if (valSQL) {
          return (
            `SELECT __filter.* FROM (${inputSQL}) __filter ` +
            `CROSS JOIN (SELECT * FROM (${valSQL}) __tvq LIMIT 1) __tv ` +
            `WHERE ${whereClause}`
          )
        }
      }

      return `SELECT * FROM (${inputSQL}) __filter WHERE ${whereClause}`
    }

    case 'static-value': {
      const d = node.data as StaticValueData
      const colName = d.columnName || 'value'
      const expr    = `'${(d.value ?? '').replace(/'/g, "''")}'`
      const anchorEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'anchor-in')
      if (anchorEdge) {
        const anchorSQL = buildNodeSQL(anchorEdge.source, nodes, edges, anchorEdge.sourceHandle ?? undefined)
        if (anchorSQL) return `SELECT ${expr} AS "${colName}" FROM (${anchorSQL}) __anchor`
      }
      return `SELECT ${expr} AS "${colName}"`
    }

    case 'increment-value': {
      const d = node.data as IncrementValueData
      const colName = d.columnName || 'index'
      const start   = typeof d.startAt === 'number' ? d.startAt : 1
      const expr    = start === 1
        ? `ROW_NUMBER() OVER ()`
        : `ROW_NUMBER() OVER () + ${start - 1}`
      const anchorEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'anchor-in')
      if (anchorEdge) {
        const anchorSQL = buildNodeSQL(anchorEdge.source, nodes, edges, anchorEdge.sourceHandle ?? undefined)
        if (anchorSQL) return `SELECT ${expr} AS "${colName}" FROM (${anchorSQL}) __anchor`
      }
      return `SELECT ${expr} AS "${colName}"`
    }

    case 'unique': {
      const d = node.data as UniqueNodeData
      const inputEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'row-in')
      if (!inputEdge) return null
      const inputSQL = buildNodeSQL(inputEdge.source, nodes, edges, inputEdge.sourceHandle ?? undefined)
      if (!inputSQL || !d.keyColumn) return null
      const order = d.keep === 'last' ? 'DESC' : 'ASC'
      return (
        `SELECT * EXCLUDE __seq FROM ` +
        `(SELECT *, ROW_NUMBER() OVER () AS __seq FROM (${inputSQL}) __t) ` +
        `QUALIFY ROW_NUMBER() OVER (PARTITION BY "${d.keyColumn}" ORDER BY __seq ${order}) = 1`
      )
    }

    case 'map-value': {
      const d = node.data as MapValueData
      const colName = d.columnName || 'mapped'
      const expr = emitterExpression(nodeId, nodes)
      const anchorEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'anchor-in')
      if (anchorEdge) {
        const anchorSQL = buildNodeSQL(anchorEdge.source, nodes, edges, anchorEdge.sourceHandle ?? undefined)
        if (anchorSQL && expr) return `SELECT ${expr} AS "${colName}" FROM (${anchorSQL}) __anchor`
      }
      return expr ? `SELECT ${expr} AS "${colName}"` : null
    }

    case 'conditional-output': {
      const d = node.data as ConditionalOutputData
      const colName = d.columnName || 'result'
      const expr = emitterExpression(nodeId, nodes)
      const anchorEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'anchor-in')
      if (anchorEdge) {
        const anchorSQL = buildNodeSQL(anchorEdge.source, nodes, edges, anchorEdge.sourceHandle ?? undefined)
        if (anchorSQL && expr) return `SELECT ${expr} AS "${colName}" FROM (${anchorSQL}) __anchor`
      }
      return expr ? `SELECT ${expr} AS "${colName}"` : null
    }

    case 'sort': {
      const d = node.data as SortNodeData
      const inputEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'row-in')
      if (!inputEdge) return null
      const inputSQL = buildNodeSQL(inputEdge.source, nodes, edges, inputEdge.sourceHandle ?? undefined)
      if (!inputSQL) return null
      const validKeys = (d.sortKeys ?? []).filter((k) => k.column)
      if (!validKeys.length) return `SELECT * FROM (${inputSQL}) __s`
      const orderBy = validKeys.map((k) => `"${k.column}" ${k.direction}`).join(', ')
      return `SELECT * FROM (${inputSQL}) __s ORDER BY ${orderBy}`
    }

    case 'limit': {
      const d = node.data as LimitNodeData
      const inputEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'row-in')
      if (!inputEdge) return null
      const inputSQL = buildNodeSQL(inputEdge.source, nodes, edges, inputEdge.sourceHandle ?? undefined)
      if (!inputSQL) return null
      const count  = typeof d.count  === 'number' ? Math.max(1, d.count)  : 100
      const offset = typeof d.offset === 'number' ? Math.max(0, d.offset) : 0
      return offset > 0
        ? `SELECT * FROM (${inputSQL}) __l LIMIT ${count} OFFSET ${offset}`
        : `SELECT * FROM (${inputSQL}) __l LIMIT ${count}`
    }

    case 'aggregate': {
      const d = node.data as AggregateNodeData
      const inputEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'row-in')
      if (!inputEdge) return null
      const inputSQL = buildNodeSQL(inputEdge.source, nodes, edges, inputEdge.sourceHandle ?? undefined)
      if (!inputSQL) return null

      const groupCols = (d.groupBy ?? []).map((c) => `"${c}"`)
      const aggExprs  = (d.aggregations ?? [])
        .filter((a) => a.alias)
        .map((a) => {
          const alias = `"${a.alias}"`
          switch (a.func) {
            case 'COUNT':          return `COUNT(*) AS ${alias}`
            case 'COUNT_DISTINCT': return `COUNT(DISTINCT "${a.column}") AS ${alias}`
            case 'SUM':            return `SUM("${a.column}") AS ${alias}`
            case 'AVG':            return `AVG("${a.column}") AS ${alias}`
            case 'MIN':            return `MIN("${a.column}") AS ${alias}`
            case 'MAX':            return `MAX("${a.column}") AS ${alias}`
          }
        })

      if (!groupCols.length && !aggExprs.length) return `SELECT * FROM (${inputSQL}) __agg`

      const selectParts = [...groupCols, ...aggExprs].join(', ')
      const groupByClause = groupCols.length ? ` GROUP BY ${groupCols.join(', ')}` : ''
      return `SELECT ${selectParts} FROM (${inputSQL}) __agg${groupByClause}`
    }

    case 'connection':
      return null  // provides config, not data

    case 'read-table': {
      const d = node.data as ReadTableNodeData
      if (!d.csvPath) return null
      return `SELECT * FROM read_csv_auto('${escapePath(d.csvPath)}')`
    }

    case 'read-table-cached': {
      const d = node.data as ReadTableCachedNodeData
      if (!d.csvPath) return null
      return `SELECT * FROM read_csv_auto('${escapePath(d.csvPath)}')`
    }

    case 'write-table': {
      // For preview: show the upstream data that would be written
      const inputEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'row-in')
      if (!inputEdge) return null
      return buildNodeSQL(inputEdge.source, nodes, edges, inputEdge.sourceHandle ?? undefined)
    }

    case 'browse-schema': {
      const d = node.data as BrowseSchemaNodeData
      if (!d.csvPath) return null
      return `SELECT * FROM read_csv_auto('${escapePath(d.csvPath)}')`
    }

    default:
      return null
  }
}

/** What columns does this node output? Used to populate downstream dropdowns. */
export function getNodeOutputColumns(
  nodeId: string,
  nodes: AppNode[],
  edges: AppEdge[]
): ColumnInfo[] {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return []

  switch (node.type) {
    case 'csv-input':
      return (node.data as CSVNodeData).columns

    case 'join': {
      const d = node.data as JoinNodeData
      const sel = (d.columnSelection ?? []).filter((s) => s.included)
      if (sel.length > 0) {
        return sel.map((s) => {
          const src = (s.side === 'left' ? d.leftColumns : d.rightColumns) ?? []
          const orig = src.find((c) => c.name === s.name)
          return { name: s.alias || s.name, type: orig?.type ?? 'TEXT' }
        })
      }
      // Default: all left + all right with r_ prefix
      const leftCols  = d.leftColumns ?? []
      const rightCols = (d.rightColumns ?? []).map((c) => ({ ...c, name: `r_${c.name}` }))
      return [...leftCols, ...rightCols]
    }

    case 'transform': {
      const d = node.data as TransformNodeData
      const inputCols = d.inputColumns ?? []
      const newCols = (d.expressions ?? [])
        .filter((e) => e.alias)
        .map((e) => ({ name: e.alias, type: 'TEXT' }))
      return d.keepAll ? [...inputCols, ...newCols] : newCols
    }

    case 'destination': {
      const d = node.data as DestinationNodeData
      return (d.colMap ?? [])
        .filter((m) => m.included !== false && m.destCol)
        .map((m) => ({ name: m.destCol!, type: 'TEXT' as const }))
    }

    case 'csv-output':
      return (node.data as CSVOutputNodeData).inputColumns ?? []

    case 'merge':
      return (node.data as MergeNodeData).inputColumns ?? []

    case 'filter':
      return (node.data as FilterNodeData).inputColumns ?? []

    case 'static-value': {
      const d = node.data as StaticValueData
      return [{ name: d.columnName || 'value', type: 'TEXT' }]
    }

    case 'increment-value': {
      const d = node.data as IncrementValueData
      return [{ name: d.columnName || 'index', type: 'INTEGER' }]
    }

    case 'unique':
      return (node.data as UniqueNodeData).inputColumns ?? []

    case 'map-value': {
      const d = node.data as MapValueData
      return [{ name: d.columnName || 'mapped', type: 'TEXT' }]
    }

    case 'conditional-output': {
      const d = node.data as ConditionalOutputData
      return [{ name: d.columnName || 'result', type: 'TEXT' }]
    }

    case 'sort':
      return (node.data as SortNodeData).inputColumns ?? []

    case 'limit':
      // Limit passes through columns from upstream — we need to look upstream
      return (() => {
        const inputEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'row-in')
        return inputEdge ? getNodeOutputColumns(inputEdge.source, nodes, edges) : []
      })()

    case 'aggregate': {
      const d = node.data as AggregateNodeData
      const inputCols = d.inputColumns ?? []
      const groupCols = (d.groupBy ?? []).map((name) => {
        const col = inputCols.find((c) => c.name === name)
        return { name, type: col?.type ?? 'TEXT' }
      })
      const aggCols = (d.aggregations ?? [])
        .filter((a) => a.alias)
        .map((a) => ({
          name: a.alias,
          type: (a.func === 'AVG') ? 'DOUBLE' : 'BIGINT',
        }))
      return [...groupCols, ...aggCols]
    }

    case 'connection':
      return []

    case 'read-table':
      return (node.data as ReadTableNodeData).columns ?? []

    case 'read-table-cached':
      return (node.data as ReadTableCachedNodeData).columns ?? []

    case 'write-table':
      return (node.data as WriteTableNodeData).inputColumns ?? []

    case 'browse-schema':
      return (node.data as BrowseSchemaNodeData).columns ?? []

    default:
      return []
  }
}
