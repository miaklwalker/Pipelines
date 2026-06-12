/**
 * Shared execution logic for the HTTP API nodes (GET/DELETE/POST/PUT/PATCH/
 * paginated). Used by the node components' own Fetch buttons AND by the
 * pipeline execution engine, so a seq-wired API node runs identically in both.
 */
import type {
  AppNode, AppEdge, ApiHeader,
  ApiGetNodeData, ApiBodyNodeData, ApiAuthNodeData, ApiPaginatedNodeData,
} from './types'
import { buildNodeSQL } from './sqlBuilder'

export function buildHeaders(headers: ApiHeader[]): Record<string, string> {
  const h: Record<string, string> = {}
  headers.forEach((hdr) => { if (hdr.key.trim()) h[hdr.key.trim()] = hdr.value })
  return h
}

/** Resolve a wired api-auth token into the header it injects, if any. */
export function resolveToken(
  id: string,
  edges: AppEdge[],
  nodes: AppNode[]
): { headerName: string; headerValue: string } | null {
  const tokenEdge = edges.find((e) => e.target === id && e.targetHandle === 'token-in')
  if (!tokenEdge) return null
  const authNode = nodes.find((n) => n.id === tokenEdge.source && n.type === 'api-auth')
  if (!authNode) return null
  const d = authNode.data as ApiAuthNodeData
  if (!d.token) return null
  return {
    headerName: d.headerName || 'Authorization',
    headerValue: (d.headerTemplate || 'Bearer {{token}}').replace('{{token}}', d.token),
  }
}

/**
 * Execute an API node and return the data patch to apply on success.
 * Throws on failure (callers set their own error state).
 */
export async function executeApiNode(
  node: AppNode,
  nodes: AppNode[],
  edges: AppEdge[]
): Promise<Record<string, unknown>> {
  const lastFetched = new Date().toISOString()

  if (node.type === 'api-paginated') {
    const d = node.data as ApiPaginatedNodeData
    if (!d.url?.trim()) throw new Error('Enter a URL first')
    const hdrs = buildHeaders(d.headers ?? [])
    const tok = resolveToken(node.id, edges, nodes)
    if (tok) hdrs[tok.headerName] = tok.headerValue

    const result = await window.api.apiPaginated({
      url: d.url.trim(), headers: hdrs, strategy: d.strategy ?? 'page', nodeId: node.id,
      pageParam: d.pageParam ?? 'page', pageStart: d.pageStart ?? 1,
      offsetParam: d.offsetParam ?? 'offset', limitParam: d.limitParam ?? 'limit',
      limitValue: d.limitValue ?? 100,
      cursorPath: d.cursorPath ?? '', cursorParam: d.cursorParam ?? 'cursor',
      cursorIn: d.cursorIn ?? 'query',
      dataPath: (d.dataPath ?? '').trim() || undefined,
      maxPages: d.maxPages ?? 100, failOnError: d.failOnError ?? false,
    })
    return {
      jsonPath: result.jsonPath, columns: result.columns, rowCount: result.rowCount,
      pagesFetched: result.pagesFetched, hadErrors: result.hadErrors,
      status: 'done', error: undefined, lastFetched,
    }
  }

  if (node.type === 'api-get' || node.type === 'api-delete') {
    const d = node.data as ApiGetNodeData
    if (!d.url?.trim()) throw new Error('Enter a URL first')
    const hdrs = buildHeaders(d.headers ?? [])
    const tok = resolveToken(node.id, edges, nodes)
    if (tok) hdrs[tok.headerName] = tok.headerValue

    const result = await window.api.apiFetch({
      url: d.url.trim(), method: d.method, headers: hdrs, nodeId: node.id,
    })
    return {
      jsonPath: result.jsonPath, columns: result.columns, rowCount: result.rowCount,
      status: 'done', error: undefined, lastFetched,
    }
  }

  if (node.type === 'api-post' || node.type === 'api-put' || node.type === 'api-patch') {
    const d = node.data as ApiBodyNodeData
    if (!d.url?.trim()) throw new Error('Enter a URL first')
    const hdrs = buildHeaders(d.headers ?? [])
    const tok = resolveToken(node.id, edges, nodes)
    if (tok) hdrs[tok.headerName] = tok.headerValue

    let upstreamSQL: string | undefined
    let body: string | undefined
    const rowEdge = edges.find((e) => e.target === node.id && e.targetHandle === 'row-in')
    if (d.bodyMode === 'upstream' && rowEdge) {
      upstreamSQL = buildNodeSQL(rowEdge.source, nodes, edges, rowEdge.sourceHandle ?? undefined) ?? undefined
    } else if (d.staticBody?.trim()) {
      body = d.staticBody.trim()
    }

    const result = await window.api.apiFetch({
      url: d.url.trim(), method: d.method, headers: hdrs, body, upstreamSQL, nodeId: node.id,
    })
    return {
      jsonPath: result.jsonPath, columns: result.columns, rowCount: result.rowCount,
      status: 'done', error: undefined, lastFetched,
    }
  }

  throw new Error(`Not an API node: ${node.type}`)
}
