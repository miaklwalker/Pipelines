import { useCallback, useState, useRef, useEffect, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  BackgroundVariant,
  type OnConnect,
  type OnNodesChange,
  type OnEdgesChange,
  type Connection,
  type IsValidConnection,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { FolderOpen, Save, Play, Loader, RefreshCw, RotateCcw, Square } from 'lucide-react'

import { v4 as uuid } from 'uuid'
import { buildNodeSQL, getNodeOutputColumns, buildPgTableQuery } from './lib/sqlBuilder'
import { propagateColumns, computeNodeDisplayColors, getUpstreamNodeIds } from './lib/graphUtils'
import { isRowStreamEdge } from './lib/traversal'
import { planExecution } from './lib/execution'
import { executeApiNode } from './lib/apiExec'
import { isCancelledError } from '../../shared/ipc'
import { NodeColorProvider } from './contexts/NodeColorContext'
import { PipelineActionsProvider } from './contexts/PipelineActionsContext'
import type {
  AppNode, AppEdge,
  CSVOutputNodeData, IncrementValueData,
  MapValueData, ConditionalOutputData, LimitNodeData,
  ConnectionNodeData, ReadTableNodeData, ReadTableCachedNodeData, WriteTableNodeData,
  BrowseSchemaNodeData,
  MaterializeNodeData,
  UpdateDbRowNodeData, RawQueryNodeData,
  PreviewResult, ReportResult, PgConfig,
} from './lib/types'

// Node registry — imports all nodes (registers them), exports NODE_TYPES
import { NODE_TYPES, getNodeDef } from './nodes'
import { delimiterChar } from './nodes/CSVOutputNode'

import Sidebar         from './components/Sidebar'
import PreviewDrawer   from './components/PreviewDrawer'
import ReportDrawer    from './components/ReportDrawer'

// ── Edge class based on handle type ──────────────────────────────────────────
function edgeClass(connection: Connection | AppEdge): string {
  const src = (connection as AppEdge).sourceHandle ?? ''
  const tgt = (connection as AppEdge).targetHandle ?? ''
  if (src === 'seq-out')          return 'seq-edge'
  if (src.startsWith('col-') || src === 'col-out') return 'col-edge'
  if (src === 'conn-out')         return 'conn-edge'
  if (src === 'token-out')        return 'token-edge'
  if (tgt === 'anchor-in')        return 'row-edge anchor-edge'
  if (src === 'row-out-pass')     return 'row-edge row-edge-pass'
  if (src === 'row-out-fail')     return 'row-edge row-edge-fail'
  return 'row-edge'
}

// ── Fallback position helper (used before ReactFlow mounts) ───────────────────
let nodeCounter = 0
function fallbackPosition() {
  const y = 160 + (nodeCounter % 5) * 48
  const x = 260 + Math.floor(nodeCounter / 5) * 340
  nodeCounter++
  return { x, y }
}

// ── Upstream edge distance BFS ────────────────────────────────────────────────
// Returns a map of edgeId → depth (0 = direct input to nodeId, 1 = one step up, …)
// Walks data-carrying edges only — sequence/token wires don't feed the preview.
function getUpstreamEdgeDistances(nodeId: string, edges: AppEdge[]): Map<string, number> {
  const dataEdges = edges.filter((e) => isRowStreamEdge(e) || e.sourceHandle?.startsWith('col-') || e.sourceHandle === 'conn-out')
  const edgeDist = new Map<string, number>()
  const visitedNodes = new Set<string>([nodeId])
  let frontier = [nodeId]
  let depth = 0
  while (frontier.length > 0) {
    const next: string[] = []
    for (const tid of frontier) {
      for (const e of dataEdges) {
        if (e.target === tid && !edgeDist.has(e.id)) {
          edgeDist.set(e.id, depth)
          if (!visitedNodes.has(e.source)) {
            visitedNodes.add(e.source)
            next.push(e.source)
          }
        }
      }
    }
    frontier = next
    depth++
  }
  return edgeDist
}

// ── Node label for preview modal title ────────────────────────────────────────
// Value-bearing nodes show their configured value; everything else falls back
// to the registry display name (was a hand-maintained switch that drifted).
function nodeLabel(node: AppNode | undefined): string {
  if (!node) return ''
  const registryName = getNodeDef(node.type ?? '')?.name ?? ''
  const userLabel = (node.data as { nodeLabel?: string } | undefined)?.nodeLabel
  if (userLabel) return userLabel
  switch (node.type) {
    case 'csv-input':
    case 'json-input':
      return (node.data as { fileName?: string }).fileName || registryName
    case 'map-value':           return (node.data as MapValueData).columnName || registryName
    case 'conditional-output':  return (node.data as ConditionalOutputData).columnName || registryName
    case 'limit':               return `Limit ${(node.data as LimitNodeData).count}`
    case 'connection':          return `DB: ${(node.data as ConnectionNodeData).config?.host || 'Connection'}`
    case 'read-table':          return (node.data as ReadTableNodeData).tableName || registryName
    case 'read-table-cached':   return (node.data as ReadTableCachedNodeData).tableName || registryName
    case 'write-table':         return (node.data as WriteTableNodeData).tableName || registryName
    case 'update-db-row':       return (node.data as UpdateDbRowNodeData).tableName || registryName
    case 'raw-query':           return registryName
    case 'browse-schema': {
      const d = node.data as BrowseSchemaNodeData
      return d.selectedTable ? `${d.selectedSchema}.${d.selectedTable}` : registryName
    }
    default:
      return registryName
  }
}

// ── Saved-file credential handling ────────────────────────────────────────────
// Connection passwords are encrypted with Electron safeStorage before hitting
// disk, and the derived `resolvedConfig` copies (which embed the plaintext
// password) are stripped — propagateColumns rebuilds them on load.

async function sanitizeNodesForSave(nodes: AppNode[]): Promise<AppNode[]> {
  const out: AppNode[] = []
  for (const n of nodes) {
    const data = { ...(n.data as Record<string, unknown>) }
    if ('resolvedConfig' in data) delete data.resolvedConfig
    if (n.type === 'connection' && data.config) {
      const cfg = { ...(data.config as PgConfig) }
      if (cfg.password) {
        const enc = await window.api.secureEncrypt(cfg.password)
        if (enc) {
          data.passwordEnc = enc
          cfg.password = ''
        }
        // enc === null → safeStorage unavailable; fall back to legacy plaintext
      }
      data.config = cfg
    }
    out.push({ ...n, data } as AppNode)
  }
  return out
}

async function restoreNodeSecrets(nodes: AppNode[]): Promise<AppNode[]> {
  const out: AppNode[] = []
  for (const n of nodes) {
    if (n.type === 'connection') {
      const data = n.data as Record<string, unknown>
      const enc = data.passwordEnc as string | undefined
      const cfg = data.config as PgConfig | undefined
      if (enc && cfg && !cfg.password) {
        const plain = await window.api.secureDecrypt(enc)
        if (plain != null) {
          out.push({ ...n, data: { ...data, config: { ...cfg, password: plain } } } as AppNode)
          continue
        }
      }
    }
    out.push(n)
  }
  return out
}

// ── Pipeline execution phase ──────────────────────────────────────────────────
type ExecPhase = 'idle' | 'running' | 'done' | 'error'

// ── Tab ───────────────────────────────────────────────────────────────────────
interface PipelineTab {
  id: string
  filePath: string | null
  nodes: AppNode[]
  edges: AppEdge[]
  nodeUserColors: Record<string, string>
}
const INITIAL_TAB_ID = 'tab-0'

// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [nodes, setNodes] = useState<AppNode[]>([])
  const [edges, setEdges] = useState<AppEdge[]>([])

  // Current saved file path — set after first save so subsequent ⌘S skips dialog
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null)

  // Preview state
  const [previewNodeId,  setPreviewNodeId]  = useState<string | null>(null)
  const [previewResult,  setPreviewResult]  = useState<PreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError,   setPreviewError]   = useState<string | null>(null)

  // Report state — Report node clicks open the report drawer instead of the preview
  const [reportResult,  setReportResult]  = useState<ReportResult | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError,   setReportError]   = useState<string | null>(null)

  // Pipeline execution state — maps nodeId → exec phase for visual feedback
  const [nodeExecState, setNodeExecState] = useState<Record<string, ExecPhase>>({})
  const [isExecuting, setIsExecuting] = useState(false)
  const isExecutingRef = useRef(false)
  // Stop request — checked between plan actions; the in-flight action finishes,
  // everything after it is skipped (main-process IPC calls aren't abortable).
  const stopRequestedRef = useRef(false)

  // Full execution mode — re-materializes Parquet nodes and re-fetches cached DB nodes before running
  const [fullExecution, setFullExecution] = useState(false)
  const fullExecutionRef = useRef(fullExecution)
  fullExecutionRef.current = fullExecution

  // Queued downstream cascades — node ids whose refresh wants to re-run its
  // downstream subgraph. Processed in a useEffect once no run is active, so
  // refreshes during a run queue up instead of being dropped, and multiple
  // quick refreshes merge into a single execution.
  const [pendingCascade, setPendingCascade] = useState<Set<string>>(new Set())

  // Tab management
  const [tabs, setTabs] = useState<PipelineTab[]>([
    { id: INITIAL_TAB_ID, filePath: null, nodes: [], edges: [], nodeUserColors: {} },
  ])
  const [activeTabId, setActiveTabId] = useState<string>(INITIAL_TAB_ID)

  // Node color coding — user-set colors + computed propagated colors
  const [nodeUserColors, setNodeUserColors] = useState<Record<string, string>>({})
  const setUserColor = useCallback((nodeId: string, color: string | null) => {
    setNodeUserColors((prev) => {
      if (color === null) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [nodeId]: _removed, ...rest } = prev
        return rest
      }
      return { ...prev, [nodeId]: color }
    })
  }, [])
  const displayColors = useMemo(
    () => computeNodeDisplayColors(nodes, edges, nodeUserColors),
    [nodes, edges, nodeUserColors],
  )
  const colorContextValue = useMemo(
    () => ({ displayColors, userColors: nodeUserColors, setUserColor }),
    [displayColors, nodeUserColors, setUserColor],
  )

  // ReactFlow instance — used to convert screen coords to flow coords for spawning
  const rfRef = useRef<ReactFlowInstance<AppNode, AppEdge> | null>(null)

  /** Returns the center of the visible canvas in flow-space, with a small jitter. */
  const spawnPosition = useCallback(() => {
    const rf = rfRef.current
    if (!rf) return fallbackPosition()
    const el = document.querySelector('.react-flow') as HTMLElement | null
    if (!el) return fallbackPosition()
    const rect = el.getBoundingClientRect()
    const jitter = () => (Math.random() - 0.5) * 80   // ±40 px so quick multi-drops don't stack
    return rf.screenToFlowPosition({
      x: rect.left + rect.width  / 2 + jitter(),
      y: rect.top  + rect.height / 2 + jitter(),
    })
  }, [])

  // Topbar toast
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 3000)
  }, [])

  // ── Tab helpers ───────────────────────────────────────────────────────────
  const tabLabel = (filePath: string | null) => {
    if (!filePath) return 'Untitled'
    const name = filePath.replace(/\\/g, '/').split('/').pop() ?? 'Untitled'
    return name.replace(/\.pipes$/, '') || 'Untitled'
  }

  const switchToTab = useCallback((tabId: string) => {
    if (tabId === activeTabId) return
    setTabs(prev => {
      const updated = prev.map(t =>
        t.id === activeTabId
          ? { ...t, filePath: filePathRef.current, nodes: nodesRef.current, edges: edgesRef.current, nodeUserColors: nodeUserColorsRef.current }
          : t
      )
      const target = updated.find(t => t.id === tabId)
      if (target) {
        setNodes(target.nodes)
        setEdges(target.edges)
        setCurrentFilePath(target.filePath)
        setNodeUserColors(target.nodeUserColors)
      }
      return updated
    })
    setActiveTabId(tabId)
    setPreviewNodeId(null)
    setPreviewResult(null)
    setReportResult(null)
    setNodeExecState({})
  }, [activeTabId])

  const openNewTab = useCallback(() => {
    const newId = `tab-${Date.now()}`
    setTabs(prev => [
      ...prev.map(t =>
        t.id === activeTabId
          ? { ...t, filePath: filePathRef.current, nodes: nodesRef.current, edges: edgesRef.current, nodeUserColors: nodeUserColorsRef.current }
          : t
      ),
      { id: newId, filePath: null, nodes: [], edges: [], nodeUserColors: {} },
    ])
    setActiveTabId(newId)
    setNodes([])
    setEdges([])
    setCurrentFilePath(null)
    setNodeUserColors({})
    setPreviewNodeId(null)
    setPreviewResult(null)
    setReportResult(null)
    setNodeExecState({})
  }, [activeTabId])

  const closeTab = useCallback((tabId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (tabs.length === 1) {
      // Clear the only tab instead of removing it
      setNodes([])
      setEdges([])
      setCurrentFilePath(null)
      setNodeUserColors({})
      setTabs([{ ...tabs[0], filePath: null, nodes: [], edges: [], nodeUserColors: {} }])
      return
    }
    const newTabs = tabs.filter(t => t.id !== tabId)
    setTabs(newTabs)
    if (tabId === activeTabId) {
      const idx = tabs.findIndex(t => t.id === tabId)
      const next = newTabs[Math.min(idx, newTabs.length - 1)]
      setNodes(next.nodes)
      setEdges(next.edges)
      setCurrentFilePath(next.filePath)
      setNodeUserColors(next.nodeUserColors)
      setActiveTabId(next.id)
      setPreviewNodeId(null)
      setPreviewResult(null)
      setReportResult(null)
      setNodeExecState({})
    }
  }, [tabs, activeTabId])

  // Stable refs for callbacks that need current state
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const edgesRef = useRef(edges)
  edgesRef.current = edges
  const filePathRef = useRef(currentFilePath)
  filePathRef.current = currentFilePath
  const nodeUserColorsRef = useRef(nodeUserColors)
  nodeUserColorsRef.current = nodeUserColors

  // ── React Flow handlers ───────────────────────────────────────────────────
  const onNodesChange: OnNodesChange<AppNode> = useCallback(
    (changes) => setNodes((ns) => applyNodeChanges(changes, ns) as AppNode[]),
    []
  )

  const onEdgesChange: OnEdgesChange<AppEdge> = useCallback(
    (changes) => setEdges((es) => applyEdgeChanges(changes, es) as AppEdge[]),
    []
  )

  const onConnect: OnConnect = useCallback((connection) => {
    const cls = edgeClass(connection)
    setEdges((es) => {
      const tgt = connection.targetHandle ?? ''
      const shouldReplace = tgt.startsWith('row-') || tgt.startsWith('col-')
        || tgt === 'val-in' || tgt === 'anchor-in' || tgt === 'conn-in' || tgt === 'token-in'
      const filtered = shouldReplace
        ? es.filter((e) => !(e.target === connection.target && e.targetHandle === connection.targetHandle))
        : es
      return addEdge({ ...connection, className: cls, animated: false }, filtered) as AppEdge[]
    })
  }, [])

  // Re-derive node columns whenever the wiring changes. Doing this in an effect
  // (instead of inside the setEdges updater) keeps the state updaters pure —
  // React 18 StrictMode double-invokes updaters and flags side effects in them.
  // It also covers project load: setting edges propagates columns/configs once.
  useEffect(() => {
    setNodes((ns) => propagateColumns(ns as AppNode[], edges))
  }, [edges])

  const isValidConnection = useCallback<IsValidConnection<AppEdge>>((connection) => {
    if (connection.source === connection.target) return false
    const src = connection.sourceHandle ?? ''
    const tgt = connection.targetHandle ?? ''
    const sourceNode = nodesRef.current.find((n) => n.id === connection.source)
    // Row source handles (including Filter's pass/fail branches)
    const srcRow = src === 'row-out' || src === 'row-out-pass' || src === 'row-out-fail'
    // Row target handles (including Filter's val-in and emitter anchor-in)
    const tgtRow = tgt === 'row-left' || tgt === 'row-right' || tgt === 'row-in'
      || tgt === 'row-ref' || tgt === 'val-in' || tgt === 'anchor-in'
    // Column handles (emitters use plain 'col-out', others use 'col-out-{name}')
    const srcCol  = src.startsWith('col-out-') || src === 'col-out'
    const tgtCol  = tgt.startsWith('col-in-')
    const srcConn  = src === 'conn-out'
    const tgtConn  = tgt === 'conn-in'
    const srcSeq   = src === 'seq-out'
    const tgtSeq   = tgt === 'seq-in'
    const srcToken = src === 'token-out'
    const tgtToken = tgt === 'token-in'
    if (tgt === 'col-in-carry') {
      return sourceNode?.type === 'increment-value' && src === 'col-out'
    }
    return (srcRow && tgtRow) || (srcCol && tgtCol) || (srcConn && tgtConn) || (srcSeq && tgtSeq) || (srcToken && tgtToken)
  }, [])

  // ── Canvas click → clear selection ───────────────────────────────────────
  const onPaneClick = useCallback(() => setPreviewNodeId(null), [])

  const refetchMissingCachedSource = useCallback(async (missingPath: string): Promise<boolean> => {
    const cached = nodesRef.current.find((n) => (
      n.type === 'read-table-cached'
      && (n.data as ReadTableCachedNodeData).csvPath === missingPath
    ))
    if (!cached) return false

    const d = cached.data as ReadTableCachedNodeData
    if (!d.resolvedConfig) return false

    const query = d.readMode === 'table'
      ? (d.tableName ? buildPgTableQuery(d.dbSelectedSchema, d.tableName) : '')
      : d.customSQL
    if (!query.trim()) return false

    try {
      const result = await window.api.pgFetchCached(d.resolvedConfig, query, false)
      setNodes((ns) => {
        const updated = ns.map((n) => (
          n.id === cached.id
            ? {
                ...n,
                data: {
                  ...n.data,
                  csvPath: result.csvPath,
                  columns: result.columns,
                  rowCount: result.rowCount,
                  status: 'ready',
                  error: undefined,
                  cacheDate: result.cacheDate ?? new Date().toISOString(),
                },
              }
            : n
        )) as AppNode[]
        return propagateColumns(updated, edgesRef.current)
      })
      return true
    } catch {
      return false
    }
  }, [setNodes])

  const applyPreviewResult = useCallback((node: AppNode, result: PreviewResult) => {
    setPreviewResult(result)
    if (node.type === 'increment-value') {
      const nodeData = node.data as IncrementValueData
      const anchorEdge = edgesRef.current.find((e) => e.target === node.id && e.targetHandle === 'anchor-in')
      const anchorNode = anchorEdge ? nodesRef.current.find((n) => n.id === anchorEdge.source) : null
      const anchorRowCount = anchorNode && typeof (anchorNode.data as { rowCount?: unknown }).rowCount === 'number'
        ? (anchorNode.data as { rowCount: number }).rowCount
        : null
      const previewCount = typeof result.rowCount === 'number' && Number.isFinite(result.rowCount)
        ? result.rowCount
        : (typeof anchorRowCount === 'number' && Number.isFinite(anchorRowCount)
          ? anchorRowCount
          : result.rows.length)
      const carryBase = typeof nodeData.carryFromLastValue === 'number' ? nodeData.carryFromLastValue : 0
      const startAt = typeof nodeData.startAt === 'number' ? nodeData.startAt : 1
      const lastValue = previewCount > 0
        ? carryBase + startAt - 1 + previewCount
        : null
      setNodes((ns) => {
        const nextNodes = ns.map((n) => (
          n.id === node.id
            ? { ...n, data: { ...n.data, lastValue: Number.isFinite(lastValue ?? NaN) ? lastValue : null } }
            : n
        )) as AppNode[]
        return propagateColumns(nextNodes, edgesRef.current)
      })
    }
  }, [setNodes])

  // ── Node click → profile (Report node) ────────────────────────────────────
  const profileReportNode = useCallback((node: AppNode) => {
    const nodes = nodesRef.current
    const edges = edgesRef.current
    const sql = buildNodeSQL(node.id, nodes, edges)
    setPreviewNodeId(node.id)
    setReportResult(null)
    setReportError(null)
    if (!sql) {
      setReportError('No complete pipeline yet — connect a row input.')
      return
    }
    const cols = getNodeOutputColumns(node.id, nodes, edges)
    setReportLoading(true)
    window.api.dbProfile(sql, cols)
      .then((result) => {
        setReportResult(result)
        setReportLoading(false)
        setNodes((ns) => ns.map((n) =>
          n.id === node.id ? { ...n, data: { ...n.data, result, status: 'done', error: undefined } } : n
        ) as AppNode[])
      })
      .catch((err: Error) => {
        setReportError(err.message ?? String(err))
        setReportLoading(false)
      })
  }, [])

  // ── Node click → preview ──────────────────────────────────────────────────
  const onNodeClick = useCallback((_: React.MouseEvent, node: AppNode) => {
    if (node.type === 'report') {
      profileReportNode(node)
      return
    }
    const sql = buildNodeSQL(node.id, nodesRef.current, edgesRef.current)
    setPreviewNodeId(node.id)
    setPreviewResult(null)
    setPreviewError(null)

    if (!sql) {
      setPreviewError('No complete pipeline yet — connect all required inputs.')
      return
    }
    setPreviewLoading(true)
    window.api.dbPreview(sql)
      .then((result) => {
        applyPreviewResult(node, result)
        setPreviewLoading(false)
      })
      .catch(async (err: Error) => {
        const message = err.message ?? String(err)
        const missingPathMatch = message.match(/No files found that match the pattern "([^"]+)"/)
        if (missingPathMatch?.[1]) {
          const recovered = await refetchMissingCachedSource(missingPathMatch[1])
          if (recovered) {
            try {
              const retried = await window.api.dbPreview(sql)
              applyPreviewResult(node, retried)
              setPreviewLoading(false)
              showToast('Cache file was missing. Refetched cached source and retried preview.')
              return
            } catch (retryErr) {
              setPreviewError(retryErr instanceof Error ? retryErr.message : String(retryErr))
              setPreviewLoading(false)
              return
            }
          }
        }
        setPreviewError(message)
        setPreviewLoading(false)
      })
  }, [applyPreviewResult, refetchMissingCachedSource, showToast, profileReportNode])

  // ── Node label for preview modal title ───────────────────────────────────
  // (also handles new node types)

  // ── Sidebar add dispatcher ─────────────────────────────────────────────────
  // Registry-driven: every registered node spawns from its def's defaultData().
  // (The old hand-written switch silently ignored node types it didn't know.)
  const handleSidebarAdd = useCallback(async (type: string) => {
    // File inputs open a picker before the node exists
    if (type === 'csv-input' || type === 'json-input') {
      const result = type === 'csv-input' ? await window.api.selectCSV() : await window.api.selectJSON()
      if (!result) return
      setNodes((ns) => [...ns, {
        id: uuid(), type, position: spawnPosition(),
        data: { fileName: result.fileName, filePath: result.filePath, columns: result.columns },
      } as AppNode])
      return
    }
    const def = getNodeDef(type)
    if (!def) return
    setNodes((ns) => [...ns, {
      id: uuid(), type, position: spawnPosition(), data: def.defaultData(),
    } as AppNode])
  }, [spawnPosition])

  // ── Save project ──────────────────────────────────────────────────────────
  const saveProject = useCallback(async (forceDialog = false) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const replacer = (_: string, v: any) => (typeof v === 'bigint' ? Number(v) : v)
    const payload = JSON.stringify({
      version: 1,
      nodes: await sanitizeNodesForSave(nodesRef.current),
      edges: edgesRef.current,
      nodeUserColors: nodeUserColorsRef.current,
    }, replacer, 2)
    const knownPath = filePathRef.current

    if (knownPath && !forceDialog) {
      // Subsequent saves: write directly, no dialog
      await window.api.saveToPath(knownPath, payload)
      showToast(`Saved → ${knownPath.split('/').pop()}`)
      return
    }

    // First save (or Cmd+Shift+S): show dialog
    const savedPath = await window.api.saveProject(payload)
    if (savedPath) {
      setCurrentFilePath(savedPath)
      showToast(`Saved → ${savedPath.split('/').pop()}`)
    }
  }, [showToast])

  // ── Load project ──────────────────────────────────────────────────────────
  const loadProject = useCallback(async () => {
    const loaded = await window.api.loadProject()
    if (!loaded) return
    try {
      const parsed = JSON.parse(loaded.data) as {
        version: number
        nodes: AppNode[]
        edges: AppEdge[]
        nodeUserColors?: Record<string, string>
      }
      if (!parsed.nodes || !parsed.edges) throw new Error('Invalid file format')
      nodeCounter = parsed.nodes.length
      // Decrypt connection passwords; the edges effect re-runs propagateColumns
      // which rebuilds the stripped resolvedConfig copies.
      setNodes(await restoreNodeSecrets(parsed.nodes))
      setEdges(parsed.edges)
      setNodeUserColors(parsed.nodeUserColors ?? {})
      setCurrentFilePath(loaded.path)
      showToast(`Pipeline loaded → ${loaded.path.split(/[/\\]/).pop()}`)
    } catch (err) {
      showToast('Failed to load: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [showToast])

  // ── Auto-save last file path + auto-load on startup ─────────────────────
  useEffect(() => {
    if (currentFilePath) window.api.setLastFilePath(currentFilePath)
    // Keep the active tab's label in sync whenever the file path changes
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, filePath: currentFilePath } : t))
  }, [currentFilePath, activeTabId])

  useEffect(() => {
    async function autoLoad() {
      const lastPath = await window.api.getLastFilePath()
      if (!lastPath) return
      const loaded = await window.api.loadFromPath(lastPath)
      if (!loaded) return
      try {
        const parsed = JSON.parse(loaded.data) as {
          version: number; nodes: AppNode[]; edges: AppEdge[]; nodeUserColors?: Record<string, string>
        }
        if (!parsed.nodes || !parsed.edges) return
        nodeCounter = parsed.nodes.length
        setNodes(await restoreNodeSecrets(parsed.nodes))
        setEdges(parsed.edges)
        setNodeUserColors(parsed.nodeUserColors ?? {})
        setCurrentFilePath(loaded.path)
      } catch { /* silently ignore corrupt file */ }
    }
    autoLoad()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return
      if (e.key === 's' && e.shiftKey) { e.preventDefault(); saveProject(true) }   // ⌘⇧S = Save As
      else if (e.key === 's')          { e.preventDefault(); saveProject(false) }  // ⌘S = Save
      if (e.key === 'o')               { e.preventDefault(); loadProject() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saveProject, loadProject])

  // ── Display edges: dim unrelated, animate + fade upstream on node select ─────
  const displayEdges = useMemo(() => {
    if (!previewNodeId) return edges
    const upstream = getUpstreamEdgeDistances(previewNodeId, edges)
    return edges.map((edge) => {
      const base = edge.className ?? ''
      if (upstream.has(edge.id)) {
        const d = Math.min(upstream.get(edge.id)!, 3)
        return { ...edge, className: `${base} edge-upstream-${d}`, animated: true }
      }
      return { ...edge, className: `${base} edge-dim`, animated: false }
    })
  }, [edges, previewNodeId])

  // ── Display nodes: apply per-node execution class during pipeline run ────────
  const displayNodes = useMemo(() => {
    if (!Object.keys(nodeExecState).length) return nodes
    return nodes.map((n) => {
      const phase = nodeExecState[n.id]
      return phase ? { ...n, className: `node-exec-${phase}` } : n
    })
  }, [nodes, nodeExecState])

  // ── Execute pipeline ──────────────────────────────────────────────────────
  // The plan (lib/execution.ts) decides what runs and in what order: sinks,
  // cache refreshes (Full Run / cascade), and seq-wired work nodes — ordered
  // by a real topological sort over data + sequence edges, so diverging and
  // re-merging branches execute correctly.
  const executePipeline = useCallback(async (opts?: { cascadeFrom?: Set<string>; targetSinkIds?: Set<string> }) => {
    if (isExecutingRef.current) return
    isExecutingRef.current = true
    stopRequestedRef.current = false

    const plan = planExecution(nodesRef.current, edgesRef.current, {
      fullRefresh: fullExecutionRef.current && !opts?.cascadeFrom,
      cascadeFrom: opts?.cascadeFrom,
      targetSinkIds: opts?.targetSinkIds,
    })
    if (!plan.length) {
      if (!opts?.cascadeFrom && !opts?.targetSinkIds) {
        showToast('No output nodes — add a Write Table or CSV Export node')
      }
      isExecutingRef.current = false
      return
    }

    setIsExecuting(true)

    // Pulse every node in the execution path; dim everything outside it
    const execNodeIds = new Set(plan.map((a) => a.nodeId))
    for (const a of plan) {
      for (const id of getUpstreamNodeIds(a.nodeId, edgesRef.current)) execNodeIds.add(id)
    }
    const initState: Record<string, ExecPhase> = {}
    nodesRef.current.forEach((n) => {
      initState[n.id] = execNodeIds.has(n.id) ? 'running' : 'idle'
    })
    setNodeExecState(initState)

    const refreshCount = plan.filter((a) => a.kind === 'materialize' || a.kind === 'refresh-cache').length
    if (refreshCount > 0 && fullExecutionRef.current && !opts?.cascadeFrom) {
      showToast(`↻ Full Run — refreshing ${refreshCount} cached node${refreshCount > 1 ? 's' : ''}…`)
    }

    // Apply a node-data patch, keep nodesRef current, and re-propagate columns
    // so later actions in this run build SQL against fresh paths/schemas.
    const applyNodePatch = (nodeId: string, patch: Record<string, unknown>) => {
      const updated = propagateColumns(
        nodesRef.current.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n) as AppNode[],
        edgesRef.current
      )
      nodesRef.current = updated
      setNodes(updated)
    }

    let stopped = false
    for (const action of plan) {
      if (stopRequestedRef.current) { stopped = true; break }
      const node = nodesRef.current.find((n) => n.id === action.nodeId)
      if (!node) continue
      let skipped = false

      try {
        switch (action.kind) {
          case 'materialize': {
            const d = node.data as MaterializeNodeData
            const inputEdge = edgesRef.current.find((e) => e.target === node.id && e.targetHandle === 'row-in')
            if (!inputEdge) { skipped = true; break }
            const sql = buildNodeSQL(inputEdge.source, nodesRef.current, edgesRef.current, inputEdge.sourceHandle ?? undefined)
            if (!sql) { skipped = true; break }
            const result = await window.api.materializeRun(sql, d.parquetPath ?? undefined)
            const preview = await window.api.dbPreview(`SELECT COUNT(*) AS __cnt FROM read_parquet('${result.parquetPath.replace(/'/g, "''")}')`)
            const cnt = preview.rows[0]?.[0]
            applyNodePatch(node.id, {
              parquetPath: result.parquetPath, columns: result.columns,
              status: 'done', rowCount: cnt != null ? Number(cnt) : null, error: undefined,
            })
            break
          }

          case 'refresh-cache': {
            const d = node.data as ReadTableCachedNodeData
            if (!d.resolvedConfig) { skipped = true; break }
            const query = (d.readMode === 'table'
              ? (d.tableName ? buildPgTableQuery(d.dbSelectedSchema, d.tableName) : '')
              : d.customSQL) || ''
            if (!query.trim()) { skipped = true; break }
            const result = await window.api.pgFetchCached(d.resolvedConfig, query, true)
            applyNodePatch(node.id, {
              csvPath: result.csvPath, columns: result.columns, rowCount: result.rowCount,
              status: 'ready', cacheDate: result.cacheDate ?? new Date().toISOString(), error: undefined,
            })
            break
          }

          case 'api-fetch': {
            applyNodePatch(node.id, { status: 'fetching', error: undefined })
            const patch = await executeApiNode(node, nodesRef.current, edgesRef.current)
            applyNodePatch(node.id, patch)
            break
          }

          case 'write-table': {
            const d = node.data as WriteTableNodeData
            const inputEdge = edgesRef.current.find((e) => e.target === node.id && e.targetHandle === 'row-in')
            if (!inputEdge) throw new Error('No data input connected to Write Table')
            const sql = buildNodeSQL(inputEdge.source, nodesRef.current, edgesRef.current, inputEdge.sourceHandle ?? undefined)
            if (!sql) throw new Error('Could not build upstream SQL for Write Table')
            applyNodePatch(node.id, { status: 'writing', writeProgress: null, error: undefined, rowCount: null })
            window.api.onPgWriteProgress((written, total) => {
              setNodes((ns) => ns.map((n) => n.id === node.id
                ? { ...n, data: { ...n.data, writeProgress: { written, total } } }
                : n
              ) as AppNode[])
            })
            let writeResult: { rowCount: number }
            try {
              writeResult = await window.api.pgWrite(
                d.resolvedConfig!, sql,
                { schema: d.dbSelectedSchema ?? null, table: d.tableName },
                d.writeMode
              )
            } finally {
              window.api.offPgWriteProgress()
            }
            applyNodePatch(node.id, { status: 'done', rowCount: writeResult.rowCount, writeProgress: null })
            const label = d.dbSelectedSchema ? `${d.dbSelectedSchema}.${d.tableName}` : d.tableName
            showToast(`✓ Wrote ${writeResult.rowCount.toLocaleString()} rows → ${label}`)
            break
          }

          case 'update-rows': {
            const d = node.data as UpdateDbRowNodeData
            const inputEdge = edgesRef.current.find((e) => e.target === node.id && e.targetHandle === 'row-in')
            if (!inputEdge) throw new Error('No data input connected to Update DB Row')
            const sql = buildNodeSQL(inputEdge.source, nodesRef.current, edgesRef.current, inputEdge.sourceHandle ?? undefined)
            if (!sql) throw new Error('Could not build upstream SQL for Update DB Row')
            applyNodePatch(node.id, { status: 'updating', updateProgress: null, error: undefined, rowCount: null })
            window.api.onPgUpdateProgress((written, total) => {
              setNodes((ns) => ns.map((n) => n.id === node.id
                ? { ...n, data: { ...n.data, updateProgress: { written, total } } }
                : n
              ) as AppNode[])
            })
            let updateResult: { rowCount: number }
            try {
              updateResult = await window.api.pgUpdateRows(
                d.resolvedConfig!, sql,
                { schema: d.dbSelectedSchema ?? null, table: d.tableName },
                d.pkColumn,
                d.updateColumns
              )
            } finally {
              window.api.offPgUpdateProgress()
            }
            applyNodePatch(node.id, { status: 'done', rowCount: updateResult.rowCount, updateProgress: null })
            const label = d.dbSelectedSchema ? `${d.dbSelectedSchema}.${d.tableName}` : d.tableName
            showToast(`✓ Updated ${updateResult.rowCount.toLocaleString()} rows in ${label}`)
            break
          }

          case 'raw-query': {
            const d = node.data as RawQueryNodeData
            applyNodePatch(node.id, { status: 'running', error: undefined, rowCount: null })
            const result = await window.api.pgExecQuery(d.resolvedConfig!, d.sql)
            applyNodePatch(node.id, {
              status: 'done',
              rowCount: result.rowCount,
            })
            showToast(`✓ Query executed${result.rowCount != null ? ` — ${result.rowCount} row${result.rowCount === 1 ? '' : 's'} affected` : ''}`)
            break
          }

          case 'csv-export': {
            const d = node.data as CSVOutputNodeData
            const sql = buildNodeSQL(node.id, nodesRef.current, edgesRef.current)
            if (!sql) throw new Error('Could not build SQL for CSV Export')
            const hasKnownPath = Boolean(d.outputPath && d.outputPath.trim())
            const result = await window.api.exportCSV(
              sql,
              delimiterChar(d.delimiter),
              d.includeHeader,
              hasKnownPath ? d.outputPath : undefined,
              hasKnownPath
            )
            if (!result) {
              // User cancelled the save dialog — pull this sink out of the run
              setNodeExecState((s) => ({ ...s, [node.id]: 'idle' }))
              skipped = true
              break
            }
            applyNodePatch(node.id, {
              outputPath: result.filePath,
              lastExport: { rowCount: result.rowCount, timestamp: new Date().toLocaleTimeString() },
            })
            showToast(`✓ Exported ${result.rowCount?.toLocaleString() ?? '?'} rows`)
            break
          }
        }

        if (skipped) continue

        // Success — mark the action done; sinks also light their upstream path
        setNodeExecState((s) => {
          const next: Record<string, ExecPhase> = { ...s, [action.nodeId]: 'done' }
          if (action.kind === 'write-table' || action.kind === 'csv-export' || action.kind === 'update-rows') {
            for (const id of getUpstreamNodeIds(action.nodeId, edgesRef.current)) next[id] = 'done'
          }
          return next
        })
      } catch (err) {
        window.api.offPgWriteProgress()
        if (isCancelledError(err)) {
          // Stop aborted this step mid-flight (pg:write between batches,
          // api:paginated between pages) — that's the user's doing, not a
          // failure, so the node goes back to idle instead of error. The
          // stop-requested check at the top of the loop ends the run.
          if (node.type === 'write-table') {
            applyNodePatch(node.id, { status: 'idle', error: undefined, writeProgress: null })
          } else if (node.type === 'update-db-row') {
            applyNodePatch(node.id, { status: 'idle', error: undefined, updateProgress: null })
          } else if (action.kind === 'api-fetch' || node.type === 'raw-query') {
            applyNodePatch(node.id, { status: 'idle', error: undefined })
          }
          setNodeExecState((s) => ({ ...s, [action.nodeId]: 'idle' }))
          continue
        }
        if (node.type === 'write-table') {
          applyNodePatch(node.id, { status: 'error', error: String(err), writeProgress: null })
        } else if (node.type === 'update-db-row') {
          applyNodePatch(node.id, { status: 'error', error: String(err), updateProgress: null })
        } else if (node.type === 'raw-query') {
          applyNodePatch(node.id, { status: 'error', error: String(err) })
        } else if (action.kind === 'materialize' || action.kind === 'refresh-cache' || action.kind === 'api-fetch') {
          applyNodePatch(node.id, { status: 'error', error: err instanceof Error ? err.message : String(err) })
        }
        setNodeExecState((s) => ({ ...s, [action.nodeId]: 'error' }))
        showToast(`✗ ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    if (stopped) {
      // Un-run nodes were pulsing 'running' — drop them back to idle so only
      // the steps that actually completed keep their done/error rings.
      setNodeExecState((s) => {
        const next: Record<string, ExecPhase> = {}
        for (const [id, phase] of Object.entries(s)) next[id] = phase === 'running' ? 'idle' : phase
        return next
      })
      showToast('⏹ Run stopped')
    }

    setIsExecuting(false)
    isExecutingRef.current = false
    // Hold the done/error state for 2.5 s so the user can see the result, then clear
    setTimeout(() => setNodeExecState({}), 2500)
  }, [showToast])

  // ── Stop execution ─────────────────────────────────────────────────────────
  // Halts at the next action boundary, and tells the main process to abort the
  // in-flight cancellable operation (pg:write between batches, api:paginated
  // between pages) — other IPC calls (materialize, csv fetch) still run to
  // completion first. Also drops any queued cascades so they don't kick off a
  // fresh run the moment this one stops.
  const stopExecution = useCallback(() => {
    if (!isExecutingRef.current) return
    stopRequestedRef.current = true
    setPendingCascade(new Set())
    window.api.execCancel()
    showToast('⏹ Stopping…')
  }, [showToast])

  // ── Reset node statuses ────────────────────────────────────────────────────
  // Clears stuck running/error states after a failed run. Statuses reset to
  // what the node's persisted data supports (a cached read with a cache file
  // stays 'ready', a materialize with parquet stays 'done'). Also an escape
  // hatch: force-clears the executing flag and asks any live run loop to die
  // at its next action boundary, in case a run hung and left the UI locked.
  const resetExecutionState = useCallback(() => {
    stopRequestedRef.current = true
    window.api.execCancel()
    isExecutingRef.current = false
    setIsExecuting(false)
    setPendingCascade(new Set())
    setNodeExecState({})
    setNodes((ns) => ns.map((n) => {
      const d = n.data as Record<string, unknown>
      if (!('status' in d) && !('error' in d) && !('writeProgress' in d)) return n
      const data: Record<string, unknown> = { ...d, error: undefined }
      if ('writeProgress' in d) data.writeProgress = null
      if ('status' in d) {
        data.status =
          n.type === 'read-table-cached' && d.csvPath ? 'ready'
          : n.type === 'materialize' && d.parquetPath ? 'done'
          : 'idle'
      }
      return { ...n, data } as AppNode
    }) as AppNode[])
    showToast('Node statuses reset')
  }, [showToast])

  // ── Cascade after a node manually refreshes ────────────────────────────────
  // Node components (Materialize, Read Cached) queue a cascade via context when
  // their "Run downstream after refresh" toggle is on. The plan re-runs any
  // intermediate materialize/cache nodes between the source and its sinks, so
  // cascaded writes never ship stale parquet. Queued ids wait for an active run
  // to finish (instead of being dropped) and multiple refreshes merge into one
  // downstream execution.
  const runDownstreamSinks = useCallback((nodeId: string) => {
    setPendingCascade((prev) => {
      const next = new Set(prev)
      next.add(nodeId)
      return next
    })
  }, [])

  useEffect(() => {
    if (!pendingCascade.size || isExecuting) return
    const sources = pendingCascade
    setPendingCascade(new Set())
    executePipeline({ cascadeFrom: sources })
  }, [pendingCascade, isExecuting, executePipeline])

  // Manual single-sink run (e.g. Write Table's own button) — same engine path
  // as Run, so progress/status handling exists in exactly one place.
  const runSink = useCallback((nodeId: string) => {
    executePipeline({ targetSinkIds: new Set([nodeId]) })
  }, [executePipeline])

  const pipelineActionsValue = useMemo(
    () => ({ runDownstreamSinks, runSink }),
    [runDownstreamSinks, runSink]
  )

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <PipelineActionsProvider value={pipelineActionsValue}>
    <NodeColorProvider value={colorContextValue}>
    <div className="app-layout">
      {/* Top bar */}
      <header className="topbar">
        <span className="topbar-title">Pipelines</span>

        <div className="topbar-tabs">
          {tabs.map(tab => (
            <div
              key={tab.id}
              className={`topbar-tab${tab.id === activeTabId ? ' topbar-tab--active' : ''}`}
              onClick={() => switchToTab(tab.id)}
            >
              <span className="topbar-tab-label">{tabLabel(tab.filePath)}</span>
              <button className="topbar-tab-close" onClick={(e) => closeTab(tab.id, e)} title="Close tab">×</button>
            </div>
          ))}
          <button className="topbar-tab-new" onClick={openNewTab} title="New tab">+</button>
        </div>

        {toast && (
          <span className="topbar-toast">{toast}</span>
        )}

        <div className="topbar-actions">
          <button className="topbar-btn" onClick={loadProject} title="Open pipeline (⌘O)">
            <FolderOpen size={13} strokeWidth={1.75} />
            Open
          </button>
          <button className="topbar-btn" onClick={() => saveProject(false)} title="Save pipeline (⌘S)"
            disabled={nodes.length === 0}
          >
            <Save size={13} strokeWidth={1.75} />
            {currentFilePath ? 'Save' : 'Save…'}
          </button>
          <button
            className="topbar-btn"
            onClick={resetExecutionState}
            disabled={nodes.length === 0}
            title="Reset node statuses — clears stuck running/error states"
          >
            <RotateCcw size={12} strokeWidth={2} />
            Reset
          </button>
          <button
            className={`topbar-btn${fullExecution ? ' topbar-btn-full-active' : ''}`}
            onClick={() => setFullExecution((f) => !f)}
            disabled={isExecuting}
            title={fullExecution
              ? 'Full Execution ON — re-materializes Parquet nodes and re-fetches cached DB nodes before running. Click to disable.'
              : 'Full Execution OFF — click to enable (re-runs all cached/materialized nodes on each run)'}
          >
            <RefreshCw size={11} strokeWidth={2} />
            Full
          </button>
          {isExecuting && (
            <button
              className="topbar-btn topbar-btn-stop"
              onClick={stopExecution}
              title="Stop the run — the current step finishes, the rest are skipped"
            >
              <Square size={11} strokeWidth={2} fill="currentColor" />
              Stop
            </button>
          )}
          <button
            className="topbar-btn topbar-btn-run"
            onClick={() => executePipeline()}
            disabled={isExecuting || nodes.length === 0}
            title={fullExecution
              ? 'Full Run — re-materializes + re-fetches cached nodes, then runs all output nodes'
              : 'Run all output nodes (Write Table + CSV Export)'}
          >
            {isExecuting
              ? <><Loader size={13} strokeWidth={1.75} className="spin" />Running…</>
              : <><Play size={13} strokeWidth={1.75} />{fullExecution ? 'Full Run' : 'Run'}</>}
          </button>
        </div>
      </header>

      <div className="app-body">
        <Sidebar onAdd={handleSidebarAdd} />

        <div className="canvas-wrap">
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={NODE_TYPES}
            onInit={(instance) => { rfRef.current = instance as ReactFlowInstance<AppNode, AppEdge> }}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            isValidConnection={isValidConnection}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            deleteKeyCode={['Delete', 'Backspace']}
            multiSelectionKeyCode="Shift"
            minZoom={0.2}
            maxZoom={2}
            defaultEdgeOptions={{ animated: false }}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#1e2d42" />
            <Controls showInteractive={false} />
            <MiniMap nodeColor="#1e293b" maskColor="rgba(13,17,23,0.85)" pannable zoomable />
          </ReactFlow>

          {nodes.length === 0 && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex',
              flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none', gap: 12,
            }}>
              <div style={{ color: 'var(--text-muted)', opacity: 0.5 }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
                  <line x1="10" y1="6.5" x2="14" y2="6.5" /><line x1="10" y1="17.5" x2="14" y2="17.5" />
                </svg>
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-dim)' }}>
                Start by adding a CSV input
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Click "CSV File" in the sidebar · ⌘S to save · ⌘O to open
              </div>
            </div>
          )}

          {previewNodeId && (
            nodes.find((n) => n.id === previewNodeId)?.type === 'report' ? (
              <ReportDrawer
                nodeLabel={nodeLabel(nodes.find((n) => n.id === previewNodeId))}
                result={reportResult}
                loading={reportLoading}
                error={reportError}
                onClose={() => setPreviewNodeId(null)}
              />
            ) : (
              <PreviewDrawer
                nodeLabel={nodeLabel(nodes.find((n) => n.id === previewNodeId))}
                result={previewResult}
                loading={previewLoading}
                error={previewError}
                onClose={() => setPreviewNodeId(null)}
              />
            )
          )}
        </div>
      </div>
    </div>
    </NodeColorProvider>
    </PipelineActionsProvider>
  )
}
