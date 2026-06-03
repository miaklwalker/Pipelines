import type {
  AppNode, AppEdge,
  CSVNodeData, JSONNodeData, UnnestNodeData, JsonExtractNodeData, JsonExtractField, JoinNodeData, TransformNodeData, DestinationNodeData, CSVOutputNodeData,
  MergeNodeData, FilterNodeData, StaticValueData, IncrementValueData,
  UniqueNodeData, MapValueData, ConditionalOutputData,
  SortNodeData, LimitNodeData, AggregateNodeData,
  ReadTableNodeData, ReadTableCachedNodeData, WriteTableNodeData,
  BrowseSchemaNodeData, JoinColSelection,
  MaterializeNodeData,
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
    const base = start === 1
      ? `ROW_NUMBER() OVER ()`
      : `ROW_NUMBER() OVER () + ${start - 1}`
    const carryBase = typeof d.carryFromLastValue === 'number' ? d.carryFromLastValue : 0
    return carryBase > 0 ? `${base} + ${carryBase}` : base
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

function findDestinationColumnInputEdge(
  nodeId: string,
  destCol: string,
  edges: AppEdge[]
): AppEdge | undefined {
  return edges.find(
    (e) => e.target === nodeId && (
      e.targetHandle === `col-in-custom-${destCol}`
      || e.targetHandle === `col-in-${destCol}`
    )
  )
}

function isDestinationColumnTargetHandle(handle: string | null | undefined): boolean {
  if (!handle) return false
  return handle.startsWith('col-in-custom-') || handle.startsWith('col-in-')
}

function sourceColumnFromColOutHandle(handle: string | null | undefined): string | null {
  if (!handle) return null
  if (handle.startsWith('col-out-pass-')) return handle.slice('col-out-pass-'.length)
  if (handle.startsWith('col-out-fail-')) return handle.slice('col-out-fail-'.length)
  if (handle.startsWith('col-out-')) return handle.slice('col-out-'.length)
  return null
}

/**
 * Build the SELECT clause for a Join node, respecting any column selection.
 * Falls back to `__l.*, __r."x" AS "r_x"` when no selection is defined.
 */
function buildJoinSelect(d: JoinNodeData): string {
  const sel = (d.columnSelection ?? []).filter((s) => s.included)

  if (sel.length > 0) {
    const leftColSet  = new Set((d.leftColumns  ?? []).map((c) => c.name))
    const rightColSet = new Set((d.rightColumns ?? []).map((c) => c.name))
    const parts = sel
      // Skip stale entries whose source column no longer exists in the schema
      .filter((s) => (s.side === 'left' ? leftColSet : rightColSet).has(s.name))
      .map((s: JoinColSelection) => {
        const tbl = s.side === 'left' ? '__l' : '__r'
        // Only emit alias if it differs from the bare column name
        const needsAlias = s.alias && s.alias !== s.name
        return needsAlias
          ? `${tbl}."${s.name}" AS "${s.alias}"`
          : `${tbl}."${s.name}"`
      })
    if (parts.length) return parts.join(', ')
  }

  // Default: left.*, right cols with r_ prefix
  const rightCols = (d.rightColumns ?? [])
    .map((c) => `__r."${c.name}" AS "r_${c.name}"`)
    .join(', ')
  return rightCols ? `__l.*, ${rightCols}` : '__l.*, __r.*'
}

/**
 * Build a SELECT clause that exposes ALL columns using the same names as the
 * join's col-out handles — so the destination can reference any handle by its
 * exact handle name without alias translation.
 *
 * - Default mode (no columnSelection): left.*, right cols as r_{name}
 * - columnSelection mode: all left cols by name, all right cols using their
 *   alias (or r_{name} if no alias) — matching exactly what the handles show.
 */
function buildJoinSelectAll(d: JoinNodeData): string {
  const sel = d.columnSelection ?? []

  if (sel.length > 0) {
    // Build right parts first so we know which aliases shadow left column names.
    const rightAliases = new Set<string>()
    const rightParts: string[] = []
    for (const c of (d.rightColumns ?? [])) {
      const entry = sel.find((s) => s.name === c.name && s.side === 'right')
      const alias = entry?.alias || `r_${c.name}`
      rightAliases.add(alias)
      rightParts.push(`__r."${c.name}" AS "${alias}"`)
    }
    // Left columns: exclude any whose name is already taken by a right alias so
    // we never emit duplicate column names into the anchor subquery.
    const leftParts = (d.leftColumns ?? [])
      .filter((c) => !rightAliases.has(c.name))
      .map((c) => `__l."${c.name}"`)
    return [...leftParts, ...rightParts].join(', ') || '__l.*, __r.*'
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
  outputHandle?: string,
  opts?: { allColumns?: boolean }
): string | null {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return null

  switch (node.type) {
    case 'csv-input': {
      const d = node.data as CSVNodeData
      if (!d.filePath) return null
      return `SELECT * FROM read_csv_auto('${escapePath(d.filePath)}')`
    }

    case 'json-input': {
      const d = node.data as JSONNodeData
      if (!d.filePath) return null
      return `SELECT * FROM read_json_auto('${escapePath(d.filePath)}', format='array')`
    }

    case 'json-extract': {
      const d = node.data as JsonExtractNodeData
      const inputEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'row-in')
      if (!inputEdge) return null
      const inputSQL = buildNodeSQL(inputEdge.source, nodes, edges, inputEdge.sourceHandle ?? undefined)
      if (!inputSQL) return null

      const sourceColumn = d.sourceColumn?.trim()
      const fields = (d.fields ?? []).filter((f: JsonExtractField) => f.alias?.trim() && f.path?.trim())
      if (!sourceColumn || !fields.length) return `SELECT * FROM (${inputSQL}) __j`

      const normalizePath = (path: string) => {
        const trimmed = path.trim()
        return trimmed.startsWith('$') ? trimmed : `$.${trimmed.replace(/^\.?/, '')}`
      }

      const extractExpr = (field: JsonExtractField) => {
        const path = normalizePath(field.path)
        switch (field.type) {
          case 'TEXT':
            return `json_extract_string("${sourceColumn}", '${path}')`
          case 'INTEGER':
            return `CAST(json_extract("${sourceColumn}", '${path}') AS BIGINT)`
          case 'DOUBLE':
            return `CAST(json_extract("${sourceColumn}", '${path}') AS DOUBLE)`
          case 'BOOLEAN':
            return `CAST(json_extract("${sourceColumn}", '${path}') AS BOOLEAN)`
          case 'JSON':
            return `json_extract("${sourceColumn}", '${path}')`
        }
      }

      const selectParts = fields.map((field: JsonExtractField) => `${extractExpr(field)} AS "${field.alias}"`)
      return d.keepAll
        ? `SELECT *, ${selectParts.join(', ')} FROM (${inputSQL}) __j`
        : `SELECT ${selectParts.join(', ')} FROM (${inputSQL}) __j`
    }

    case 'unnest': {
      const d = node.data as UnnestNodeData
      const inputEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'row-in')
      if (!inputEdge) return null
      const inputSQL = buildNodeSQL(inputEdge.source, nodes, edges, inputEdge.sourceHandle ?? undefined)
      if (!inputSQL) return null
      if (!d.arrayColumn?.trim()) return `SELECT * FROM (${inputSQL}) __u`
      const arrayCol = d.arrayColumn.trim()
      const itemCol = d.itemColumn?.trim() || 'item'
      return (
        `SELECT __u.* EXCLUDE ("${arrayCol}"), ` +
        `to_json(item) AS "${itemCol}" ` +
        `FROM (${inputSQL}) __u ` +
        `CROSS JOIN UNNEST(__u."${arrayCol}") AS __items(item)`
      )
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

      // allColumns: skip columnSelection so all underlying cols are available (used by destination anchor)
      const selectClause = opts?.allColumns ? buildJoinSelectAll(d) : buildJoinSelect(d)

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
      const included = (d.colMap ?? []).filter(m => m.included !== false)
      const rowInputEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'row-in')

      const destinationColEdges = edges.filter(
        (e) => e.target === nodeId && isDestinationColumnTargetHandle(e.targetHandle)
      )

      const exactEdgeByDest = new Map<string, AppEdge>()
      const exactEdgeIds = new Set<string>()
      for (const m of included) {
        if (!m.destCol) continue
        const exact = findDestinationColumnInputEdge(nodeId, m.destCol, destinationColEdges)
        if (exact) {
          exactEdgeByDest.set(m.destCol, exact)
          exactEdgeIds.add(exact.id)
        }
      }

      const orphanColEdges = destinationColEdges.filter((e) => !exactEdgeIds.has(e.id))
      const unresolvedDestCols = included
        .filter((m) => m.destCol)
        .filter((m) => {
          const expr = m.customExpr?.trim()
          return !exactEdgeByDest.has(m.destCol!) && !m.sourceCol && !expr
        })
        .map((m) => m.destCol!)

      // Conservative recovery for stale edge target handles after a destination column rename.
      // Only auto-attach when it's unambiguous: one orphan col-edge and one unresolved destination col.
      const fallbackEdgeByDest = new Map<string, AppEdge>()

      // Prefer deterministic fallback: match mapping.sourceCol to orphan edge sourceHandle column.
      // This works even when there are multiple unresolved destination columns.
      const usedOrphanEdgeIds = new Set<string>()
      for (const m of included) {
        if (!m.destCol || !m.sourceCol || exactEdgeByDest.has(m.destCol)) continue
        const matchingOrphan = orphanColEdges.find(
          (e) => !usedOrphanEdgeIds.has(e.id) && sourceColumnFromColOutHandle(e.sourceHandle) === m.sourceCol
        )
        if (matchingOrphan) {
          fallbackEdgeByDest.set(m.destCol, matchingOrphan)
          usedOrphanEdgeIds.add(matchingOrphan.id)
        }
      }

      if (orphanColEdges.length === 1 && unresolvedDestCols.length === 1) {
        const onlyDest = unresolvedDestCols[0]
        if (!fallbackEdgeByDest.has(onlyDest)) {
          fallbackEdgeByDest.set(onlyDest, orphanColEdges[0])
        }
      }

      if (orphanColEdges.length === 1 && unresolvedDestCols.length > 1 && !usedOrphanEdgeIds.has(orphanColEdges[0].id)) {
        const orphanSourceCol = sourceColumnFromColOutHandle(orphanColEdges[0].sourceHandle) ?? ''
        const preferred = unresolvedDestCols.find((dest) => {
          const d = dest.toLowerCase()
          const s = orphanSourceCol.toLowerCase()
          return d.endsWith('_by') && (s === 'id' || s.endsWith('_id') || s.endsWith('id'))
        })
        const chosen = preferred ?? unresolvedDestCols[0]
        if (chosen && !fallbackEdgeByDest.has(chosen)) {
          fallbackEdgeByDest.set(chosen, orphanColEdges[0])
          usedOrphanEdgeIds.add(orphanColEdges[0].id)
        }
      }

      const resolveDestinationColInputEdge = (destCol: string): AppEdge | undefined =>
        exactEdgeByDest.get(destCol) || fallbackEdgeByDest.get(destCol)

      const resolveSourceColumnFromAnchor = (
        anchorId: string,
        anchorOutputNames: Set<string>,
        colInEdge: AppEdge
      ): string | null => {
        const srcHandle = colInEdge.sourceHandle ?? ''
        if (!srcHandle.startsWith('col-out-')) return null

        const srcCol = srcHandle.replace(/^col-out-(?:pass-|fail-)?/, '')

        // Same node as anchor: handle name should match output name.
        if (colInEdge.source === anchorId) {
          return anchorOutputNames.has(srcCol) ? srcCol : null
        }

        // If anchor is a join and the source is one of its inputs, translate right-side
        // columns to their join output alias (default: r_{name}).
        const anchorNode = nodes.find((n) => n.id === anchorId)
        if (anchorNode?.type === 'join') {
          const jd = anchorNode.data as JoinNodeData
          const leftEdge  = edges.find((e) => e.target === anchorId && e.targetHandle === 'row-left')
          const rightEdge = edges.find((e) => e.target === anchorId && e.targetHandle === 'row-right')

          if (leftEdge?.source === colInEdge.source) {
            return anchorOutputNames.has(srcCol) ? srcCol : null
          }

          if (rightEdge?.source === colInEdge.source) {
            const sel = jd.columnSelection ?? []
            const entry = sel.find((s) => s.name === srcCol && s.side === 'right')
            const rightName = entry?.alias || `r_${srcCol}`
            return anchorOutputNames.has(rightName) ? rightName : null
          }
        }

        // Unrelated source: only valid if anchor already exposes that exact name.
        return anchorOutputNames.has(srcCol) ? srcCol : null
      }

      if (!included.length) {
        if (!rowInputEdge) return null
        return buildNodeSQL(rowInputEdge.source, nodes, edges, rowInputEdge.sourceHandle ?? undefined)
      }

      // Find an anchor row source — either through an emitter's anchor-in, or directly from
      // a data node wired to a col-in handle (e.g. read-table col-out-{name})
      let anchorSQL: string | null = null
      let anchorNodeId: string | null = null

      // Gather candidate anchors from all wired destination inputs.
      // This works for destination nodes that are column-only (no row-in by design).
      const candidateAnchorIds = new Set<string>()
      if (rowInputEdge) candidateAnchorIds.add(rowInputEdge.source)

      // Include all wired destination column edges as candidates, even when target handles
      // are stale and don't resolve to a current destCol mapping.
      for (const e of destinationColEdges) {
        const srcHandle = e.sourceHandle ?? ''
        if (srcHandle.startsWith('col-out-')) {
          candidateAnchorIds.add(e.source)
          continue
        }
        const emitterAnchor = edges.find((ax) => ax.target === e.source && ax.targetHandle === 'anchor-in')
        if (emitterAnchor) candidateAnchorIds.add(emitterAnchor.source)
      }

      for (const m of included) {
        if (!m.destCol) continue
        const colInEdge = resolveDestinationColInputEdge(m.destCol)
        if (!colInEdge) continue
        const srcHandle = colInEdge.sourceHandle ?? ''
        if (srcHandle.startsWith('col-out-')) {
          candidateAnchorIds.add(colInEdge.source)
          continue
        }
        const emitterAnchor = edges.find((e) => e.target === colInEdge.source && e.targetHandle === 'anchor-in')
        if (emitterAnchor) candidateAnchorIds.add(emitterAnchor.source)
      }

      // Only count mappings that truly depend on an anchor column.
      const anchorRequired = included.filter((m) => {
        if (!m.destCol) return false
        const colInEdge = resolveDestinationColInputEdge(m.destCol)
        if (colInEdge) {
          const expr = emitterExpression(colInEdge.source, nodes)
          if (expr !== null) return false
          const srcHandle = colInEdge.sourceHandle ?? ''
          return srcHandle.startsWith('col-out-')
        }
        return !!m.sourceCol
      }).length

      let bestScore = -1
      let bestWidth = -1
      const evaluatedCandidateIds = new Set<string>()

      const evaluateCandidate = (candidateId: string) => {
        if (evaluatedCandidateIds.has(candidateId) || candidateId === nodeId) return
        evaluatedCandidateIds.add(candidateId)

        const candidateSQL = buildNodeSQL(candidateId, nodes, edges, undefined, { allColumns: true })
        if (!candidateSQL) return
        const candidateOutputs = new Set(getNodeOutputColumns(candidateId, nodes, edges).map((c) => c.name))

        let score = 0
        for (const m of included) {
          if (!m.destCol) continue
          const colInEdge = resolveDestinationColInputEdge(m.destCol)
          if (colInEdge) {
            const expr = emitterExpression(colInEdge.source, nodes)
            if (expr !== null) { score += 1; continue }
            if (resolveSourceColumnFromAnchor(candidateId, candidateOutputs, colInEdge)) {
              score += 1
              continue
            }
          }
          if (m.sourceCol && candidateOutputs.has(m.sourceCol)) {
            score += 1
          }
        }

        const width = candidateOutputs.size
        if (score > bestScore || (score === bestScore && width > bestWidth)) {
          bestScore = score
          bestWidth = width
          anchorNodeId = candidateId
          anchorSQL = candidateSQL
        }
      }

      for (const candidateId of candidateAnchorIds) {
        evaluateCandidate(candidateId)
      }

      // If wiring-based candidates cannot satisfy all anchor-dependent mappings,
      // broaden the search to other nodes in this graph segment (e.g. downstream join).
      if (anchorRequired > 0 && bestScore < anchorRequired) {
        for (const candidate of nodes) {
          evaluateCandidate(candidate.id)
        }
      }

      const anchorOutputNames = new Set(
        anchorNodeId
          ? getNodeOutputColumns(anchorNodeId, nodes, edges).map((c) => c.name)
          : []
      )

      const cols = included.flatMap((m) => {
        if (!m.destCol) return []
        const colInEdge = resolveDestinationColInputEdge(m.destCol)
        if (colInEdge) {
          // Emitter: use its scalar expression
          const expr = emitterExpression(colInEdge.source, nodes)
          if (expr !== null) return [`(${expr}) AS "${m.destCol}"`]

          const srcHandle = colInEdge.sourceHandle ?? ''
          if (srcHandle.startsWith('col-out-') && anchorSQL) {
            const resolvedName = anchorNodeId
              ? resolveSourceColumnFromAnchor(anchorNodeId, anchorOutputNames, colInEdge)
              : null

            if (resolvedName) {
              return [`"${resolvedName}" AS "${m.destCol}"`]
            }
          }
        }
        // Old pass-through entry (sourceCol set, no col-in wired): reference the
        // upstream column by name if we have an anchor to read it from.
        if (m.sourceCol && anchorSQL && anchorOutputNames.has(m.sourceCol)) {
          const destName = m.destCol || m.sourceCol
          return [`"${m.sourceCol}" AS "${destName}"`]
        }
        // Fall back to typed SQL expression
        const expr = m.customExpr?.trim()
        if (!expr) return [`NULL AS "${m.destCol}"`]
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

    case 'concat': {
      const leftEdge  = edges.find((e) => e.target === nodeId && e.targetHandle === 'row-left')
      const rightEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'row-right')
      if (!leftEdge || !rightEdge) return null
      const leftSQL  = buildNodeSQL(leftEdge.source, nodes, edges, leftEdge.sourceHandle ?? undefined)
      const rightSQL = buildNodeSQL(rightEdge.source, nodes, edges, rightEdge.sourceHandle ?? undefined)
      if (!leftSQL || !rightSQL) return null
      return `SELECT * FROM (${leftSQL}) UNION ALL SELECT * FROM (${rightSQL})`
    }

    case 'materialize': {
      const d = node.data as MaterializeNodeData
      if (!d.parquetPath) return null
      return `SELECT * FROM read_parquet('${escapePath(d.parquetPath)}')`
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
      const baseExpr = start === 1
        ? `ROW_NUMBER() OVER ()`
        : `ROW_NUMBER() OVER () + ${start - 1}`
      const anchorEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'anchor-in')
      const carryEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'col-in-carry')
      let carryExpr: string | null = null
      if (carryEdge) {
        const sourceNode = nodes.find((n) => n.id === carryEdge.source)
        if (sourceNode && sourceNode.type === 'increment-value') {
          const sourceData = sourceNode.data as IncrementValueData
          if (typeof sourceData.lastValue === 'number') {
            carryExpr = `${sourceData.lastValue}`
          } else {
            const sourceCol = sourceData.columnName || 'index'
            const carrySQL = buildNodeSQL(carryEdge.source, nodes, edges, carryEdge.sourceHandle ?? undefined)
            if (carrySQL) {
              carryExpr = `COALESCE((SELECT MAX("${sourceCol}") FROM (${carrySQL}) __carry), 0)`
            }
          }
        }
      }
      if (anchorEdge) {
        const anchorSQL = buildNodeSQL(anchorEdge.source, nodes, edges, anchorEdge.sourceHandle ?? undefined)
        if (anchorSQL) {
          const expr = carryExpr ? `${baseExpr} + ${carryExpr}` : baseExpr
          return `SELECT ${expr} AS "${colName}" FROM (${anchorSQL}) __anchor`
        }
      }
      const expr = carryExpr ? `${baseExpr} + ${carryExpr}` : baseExpr
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

    case 'json-input':
      return (node.data as JSONNodeData).columns

    case 'json-extract': {
      const d = node.data as JsonExtractNodeData
      const inputCols = d.inputColumns ?? []
      const fields = (d.fields ?? [])
        .filter((f: JsonExtractField) => f.alias?.trim())
        .map((f: JsonExtractField) => ({ name: f.alias, type: (f.type || 'TEXT') as string }))
      return d.keepAll ? [...inputCols, ...fields] : fields
    }

    case 'unnest': {
      const d = node.data as UnnestNodeData
      const inputEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'row-in')
      const inputCols = inputEdge ? getNodeOutputColumns(inputEdge.source, nodes, edges) : []
      if (!inputCols.length) return []
      const itemName = d.itemColumn?.trim() || 'item'
      const filtered = d.arrayColumn?.trim()
        ? inputCols.filter((c) => c.name !== d.arrayColumn.trim())
        : inputCols
      return [...filtered, { name: itemName, type: 'TEXT' }]
    }

    case 'join': {
      const d = node.data as JoinNodeData
      const sel = (d.columnSelection ?? []).filter((s) => s.included)
      if (sel.length > 0) {
        const leftColSet  = new Set((d.leftColumns  ?? []).map((c) => c.name))
        const rightColSet = new Set((d.rightColumns ?? []).map((c) => c.name))
        return sel
          // Drop stale entries whose source column no longer exists
          .filter((s) => (s.side === 'left' ? leftColSet : rightColSet).has(s.name))
          .map((s) => {
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

    case 'materialize':
      return (node.data as MaterializeNodeData).columns ?? []

    case 'merge':
      return (node.data as MergeNodeData).inputColumns ?? []

    case 'concat':
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
