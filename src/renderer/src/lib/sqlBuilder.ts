import type {
  AppNode, AppEdge,
  CSVNodeData, JoinNodeData, TransformNodeData, DestinationNodeData, CSVOutputNodeData,
  MergeNodeData, FilterNodeData, StaticValueData, IncrementValueData,
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
function emitterExpression(nodeId: string, nodes: AppNode[]): string | null {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return null

  if (node.type === 'static-value') {
    const d = node.data as StaticValueData
    return `'${(d.value ?? '').replace(/'/g, "''")}'`
  }

  if (node.type === 'increment-value') {
    const d = node.data as IncrementValueData
    const start = typeof d.startAt === 'number' ? d.startAt : 1
    return start === 1
      ? `ROW_NUMBER() OVER ()`
      : `ROW_NUMBER() OVER () + ${start - 1}`
  }

  return null
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

      const rightCols = (d.rightColumns ?? [])
        .map((c) => `__r."${c.name}" AS "r_${c.name}"`)
        .join(', ')
      const selectClause = rightCols ? `__l.*, ${rightCols}` : '__l.*, __r.*'

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
      const inputEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'row-in')
      if (!inputEdge) return null
      const inputSQL = buildNodeSQL(inputEdge.source, nodes, edges, inputEdge.sourceHandle ?? undefined)
      if (!inputSQL) return null

      const included = (d.colMap ?? []).filter((m) => m.included !== false)
      if (!included.length) return `SELECT * FROM (${inputSQL}) __dest`

      const cols = included.map((m) => {
        const destName = m.destCol || m.sourceCol

        // If an emitter is wired to this column's col-in handle, substitute its expression
        const colInEdge = edges.find(
          (e) => e.target === nodeId && e.targetHandle === `col-in-${m.sourceCol}`
        )
        if (colInEdge) {
          const expr = emitterExpression(colInEdge.source, nodes)
          if (expr !== null) return `(${expr}) AS "${destName}"`
        }

        return m.destCol && m.destCol !== m.sourceCol
          ? `"${m.sourceCol}" AS "${m.destCol}"`
          : `"${m.sourceCol}"`
      })
      return `SELECT ${cols.join(', ')} FROM (${inputSQL}) __dest`
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
      const inputCols = d.inputColumns ?? []
      const colMap    = d.colMap ?? []
      if (!colMap.length) return inputCols
      return colMap
        .filter((m) => m.included !== false)
        .map((m) => {
          const orig = inputCols.find((c) => c.name === m.sourceCol)
          return { name: m.destCol || m.sourceCol, type: orig?.type ?? 'TEXT' }
        })
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

    default:
      return []
  }
}
