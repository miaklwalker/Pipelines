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
import { FolderOpen, Save, Play, Loader } from 'lucide-react'

import { v4 as uuid } from 'uuid'
import { buildNodeSQL } from './lib/sqlBuilder'
import { propagateColumns } from './lib/graphUtils'
import type {
  AppNode, AppEdge,
  CSVNodeData, JoinNodeData, TransformNodeData, DestinationNodeData, CSVOutputNodeData,
  MergeNodeData, FilterNodeData, StaticValueData, IncrementValueData,
  ConcatNodeData,
  UniqueNodeData, MapValueData, ConditionalOutputData,
  SortNodeData, LimitNodeData, AggregateNodeData,
  ConnectionNodeData, ReadTableNodeData, ReadTableCachedNodeData, WriteTableNodeData,
  BrowseSchemaNodeData,
  MaterializeNodeData,
  PreviewResult,
} from './lib/types'

// Node registry — imports all nodes (registers them), exports NODE_TYPES
import { NODE_TYPES } from './nodes'

import Sidebar         from './components/Sidebar'
import PreviewDrawer   from './components/PreviewDrawer'

// ── Edge class based on handle type ──────────────────────────────────────────
function edgeClass(connection: Connection | AppEdge): string {
  const src = (connection as AppEdge).sourceHandle ?? ''
  const tgt = (connection as AppEdge).targetHandle ?? ''
  if (src.startsWith('col-') || src === 'col-out') return 'col-edge'
  if (src === 'conn-out')         return 'conn-edge'
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
function getUpstreamEdgeDistances(nodeId: string, edges: AppEdge[]): Map<string, number> {
  const edgeDist = new Map<string, number>()
  const visitedNodes = new Set<string>([nodeId])
  let frontier = [nodeId]
  let depth = 0
  while (frontier.length > 0) {
    const next: string[] = []
    for (const tid of frontier) {
      for (const e of edges) {
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
function nodeLabel(node: AppNode | undefined): string {
  if (!node) return ''
  if (node.type === 'csv-input')   return (node.data as CSVNodeData).fileName || 'CSV'
  if (node.type === 'join')        return 'Join'
  if (node.type === 'transform')   return 'Transform'
  if (node.type === 'destination') return 'Destination'
  if (node.type === 'csv-output')  return 'CSV Export'
  if (node.type === 'merge')           return 'Merge'
  if (node.type === 'concat')          return 'Concat'
  if (node.type === 'filter')          return 'Filter'
  if (node.type === 'static-value')        return 'Static Value'
  if (node.type === 'increment-value')     return 'Increment'
  if (node.type === 'unique')              return 'Unique'
  if (node.type === 'map-value')           return (node.data as MapValueData).columnName || 'Map'
  if (node.type === 'conditional-output')  return (node.data as ConditionalOutputData).columnName || 'Conditional'
  if (node.type === 'sort')               return 'Sort'
  if (node.type === 'limit')              return `Limit ${(node.data as LimitNodeData).count}`
  if (node.type === 'aggregate')          return 'Aggregate'
  if (node.type === 'connection')         return `DB: ${(node.data as ConnectionNodeData).config?.host || 'Connection'}`
  if (node.type === 'read-table')         return (node.data as ReadTableNodeData).tableName || 'Read Table'
  if (node.type === 'read-table-cached')  return (node.data as ReadTableCachedNodeData).tableName || 'Read (Cached)'
  if (node.type === 'write-table')        return (node.data as WriteTableNodeData).tableName || 'Write Table'
  if (node.type === 'browse-schema') {
    const d = node.data as BrowseSchemaNodeData
    return d.selectedTable ? `${d.selectedSchema}.${d.selectedTable}` : 'Browse Schema'
  }
  return ''
}

// ── Pipeline execution phase ──────────────────────────────────────────────────
type ExecPhase = 'idle' | 'running' | 'done' | 'error'

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

  // Pipeline execution state — maps nodeId → exec phase for visual feedback
  const [nodeExecState, setNodeExecState] = useState<Record<string, ExecPhase>>({})
  const [isExecuting, setIsExecuting] = useState(false)

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

  // Stable refs for callbacks that need current state
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const edgesRef = useRef(edges)
  edgesRef.current = edges
  const filePathRef = useRef(currentFilePath)
  filePathRef.current = currentFilePath

  // ── React Flow handlers ───────────────────────────────────────────────────
  const onNodesChange: OnNodesChange<AppNode> = useCallback(
    (changes) => setNodes((ns) => applyNodeChanges(changes, ns) as AppNode[]),
    []
  )

  const onEdgesChange: OnEdgesChange<AppEdge> = useCallback(
    (changes) => {
      setEdges((es) => {
        const next = applyEdgeChanges(changes, es) as AppEdge[]
        setNodes((ns) => propagateColumns(ns as AppNode[], next))
        return next
      })
    },
    []
  )

  const onConnect: OnConnect = useCallback((connection) => {
    const cls = edgeClass(connection)
    setEdges((es) => {
      const tgt = connection.targetHandle ?? ''
      const shouldReplace = tgt.startsWith('row-') || tgt.startsWith('col-')
        || tgt === 'val-in' || tgt === 'anchor-in' || tgt === 'conn-in'
      const filtered = shouldReplace
        ? es.filter((e) => !(e.target === connection.target && e.targetHandle === connection.targetHandle))
        : es
      const next = addEdge({ ...connection, className: cls, animated: false }, filtered) as AppEdge[]
      setNodes((ns) => propagateColumns(ns as AppNode[], next))
      return next
    })
  }, [])

  const isValidConnection = useCallback<IsValidConnection<AppEdge>>((connection) => {
    if (connection.source === connection.target) return false
    const src = connection.sourceHandle ?? ''
    const tgt = connection.targetHandle ?? ''
    // Row source handles (including Filter's pass/fail branches)
    const srcRow = src === 'row-out' || src === 'row-out-pass' || src === 'row-out-fail'
    // Row target handles (including Filter's val-in and emitter anchor-in)
    const tgtRow = tgt === 'row-left' || tgt === 'row-right' || tgt === 'row-in'
      || tgt === 'val-in' || tgt === 'anchor-in'
    // Column handles (emitters use plain 'col-out', others use 'col-out-{name}')
    const srcCol  = src.startsWith('col-out-') || src === 'col-out'
    const tgtCol  = tgt.startsWith('col-in-')
    const srcConn = src === 'conn-out'
    const tgtConn = tgt === 'conn-in'
    return (srcRow && tgtRow) || (srcCol && tgtCol) || (srcConn && tgtConn)
  }, [])

  // ── Canvas click → clear selection ───────────────────────────────────────
  const onPaneClick = useCallback(() => setPreviewNodeId(null), [])

  // ── Node click → preview ──────────────────────────────────────────────────
  const onNodeClick = useCallback((_: React.MouseEvent, node: AppNode) => {
    const sql = buildNodeSQL(node.id, nodesRef.current, edgesRef.current)
    setPreviewNodeId(node.id)
    setPreviewResult(null)
    setPreviewError(null)

    if (!sql) {
      setPreviewError('No complete pipeline yet — connect all required inputs.')
      return
    }
    console.log('[preview SQL]', sql)
    setPreviewLoading(true)
    window.api.dbPreview(sql)
      .then((result) => { setPreviewResult(result); setPreviewLoading(false) })
      .catch((err: Error) => { setPreviewError(err.message ?? String(err)); setPreviewLoading(false) })
  }, [])

  // ── Node label for preview modal title ───────────────────────────────────
  // (also handles new node types)

  // ── Sidebar add dispatcher ─────────────────────────────────────────────────
  const handleSidebarAdd = useCallback(async (type: string) => {
    switch (type) {
      case 'csv-input': {
        const result = await window.api.selectCSV()
        if (!result) return
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'csv-input', position: spawnPosition(),
          data: { fileName: result.fileName, filePath: result.filePath, columns: result.columns } satisfies CSVNodeData,
        }])
        break
      }
      case 'join':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'join', position: spawnPosition(),
          data: { joinType: 'INNER', leftKey: '', rightKey: '', leftColumns: [], rightColumns: [] } satisfies JoinNodeData,
        }])
        break
      case 'transform':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'transform', position: spawnPosition(),
          data: { expressions: [], keepAll: true, inputColumns: [] } satisfies TransformNodeData,
        }])
        break
      case 'destination':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'destination', position: spawnPosition(),
          data: { label: 'Output', inputColumns: [], colMap: [] } satisfies DestinationNodeData,
        }])
        break
      case 'csv-output':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'csv-output', position: spawnPosition(),
          data: { outputPath: '', includeHeader: true, inputColumns: [], lastExport: null, delimiter: 'comma' } satisfies CSVOutputNodeData,
        }])
        break
      case 'merge':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'merge', position: spawnPosition(),
          data: { inputColumns: [] } satisfies MergeNodeData,
        }])
        break
      case 'concat':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'concat', position: spawnPosition(),
          data: { inputColumns: [] } satisfies ConcatNodeData,
        }])
        break
      case 'filter':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'filter', position: spawnPosition(),
          data: { condition: '', inputColumns: [] } satisfies FilterNodeData,
        }])
        break
      case 'static-value':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'static-value', position: spawnPosition(),
          data: { columnName: 'value', value: '', hasAnchor: false } satisfies StaticValueData,
        }])
        break
      case 'increment-value':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'increment-value', position: spawnPosition(),
          data: { columnName: 'index', startAt: 1, hasAnchor: false } satisfies IncrementValueData,
        }])
        break
      case 'unique':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'unique', position: spawnPosition(),
          data: { keyColumn: '', keep: 'first', inputColumns: [] } satisfies UniqueNodeData,
        }])
        break
      case 'map-value':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'map-value', position: spawnPosition(),
          data: { columnName: 'mapped', sourceColumn: '', mappings: [], hasAnchor: false } satisfies MapValueData,
        }])
        break
      case 'conditional-output':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'conditional-output', position: spawnPosition(),
          data: { columnName: 'result', conditions: [], fallback: '', hasAnchor: false } satisfies ConditionalOutputData,
        }])
        break
      case 'sort':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'sort', position: spawnPosition(),
          data: { sortKeys: [], inputColumns: [] } satisfies SortNodeData,
        }])
        break
      case 'limit':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'limit', position: spawnPosition(),
          data: { count: 100, offset: 0 } satisfies LimitNodeData,
        }])
        break
      case 'aggregate':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'aggregate', position: spawnPosition(),
          data: { groupBy: [], aggregations: [], inputColumns: [] } satisfies AggregateNodeData,
        }])
        break
      case 'materialize':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'materialize', position: spawnPosition(),
          data: { parquetPath: null, columns: [], status: 'idle', rowCount: null } satisfies MaterializeNodeData,
        }])
        break
      case 'connection':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'connection', position: spawnPosition(),
          data: { config: { host: 'localhost', port: 5432, database: '', user: '', password: '', ssl: false }, testStatus: 'idle' } satisfies ConnectionNodeData,
        }])
        break
      case 'read-table':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'read-table', position: spawnPosition(),
          data: { readMode: 'table', tableName: '', customSQL: '', csvPath: null, columns: [], rowCount: null, status: 'idle', resolvedConfig: null } satisfies ReadTableNodeData,
        }])
        break
      case 'read-table-cached':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'read-table-cached', position: spawnPosition(),
          data: { readMode: 'table', tableName: '', customSQL: '', csvPath: null, columns: [], rowCount: null, status: 'idle', resolvedConfig: null, cacheDate: null } satisfies ReadTableCachedNodeData,
        }])
        break
      case 'write-table':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'write-table', position: spawnPosition(),
          data: { tableName: '', writeMode: 'append', status: 'idle', rowCount: null, inputColumns: [], resolvedConfig: null } satisfies WriteTableNodeData,
        }])
        break
      case 'browse-schema':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'browse-schema', position: spawnPosition(),
          data: { tables: [], selectedSchema: null, selectedTable: null, filter: '', csvPath: null, columns: [], rowCount: null, status: 'idle', resolvedConfig: null } satisfies BrowseSchemaNodeData,
        }])
        break
    }
  }, [])

  // ── Save project ──────────────────────────────────────────────────────────
  const saveProject = useCallback(async (forceDialog = false) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const replacer = (_: string, v: any) => (typeof v === 'bigint' ? Number(v) : v)
    const payload = JSON.stringify({ version: 1, nodes: nodesRef.current, edges: edgesRef.current }, replacer, 2)
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
      const parsed = JSON.parse(loaded.data) as { version: number; nodes: AppNode[]; edges: AppEdge[] }
      if (!parsed.nodes || !parsed.edges) throw new Error('Invalid file format')
      nodeCounter = parsed.nodes.length
      setNodes(parsed.nodes)
      setEdges(parsed.edges)
      setCurrentFilePath(loaded.path)
      showToast(`Pipeline loaded → ${loaded.path.split(/[/\\]/).pop()}`)
    } catch (err) {
      showToast('Failed to load: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [showToast])

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

  // ── Execute pipeline — runs all write-table / csv-output sinks in order ───────
  const executePipeline = useCallback(async () => {
    const sinkNodes = nodesRef.current.filter((n) =>
      (n.type === 'write-table' && (n.data as WriteTableNodeData).resolvedConfig && (n.data as WriteTableNodeData).tableName) ||
      n.type === 'csv-output'
    )
    if (!sinkNodes.length) {
      showToast('No output nodes — add a Write Table or CSV Export node')
      return
    }

    setIsExecuting(true)
    // Dim all nodes to 'idle' at the start of the run
    const initState: Record<string, ExecPhase> = {}
    nodesRef.current.forEach((n) => { initState[n.id] = 'idle' })
    setNodeExecState(initState)

    for (const sink of sinkNodes) {
      setNodeExecState((s) => ({ ...s, [sink.id]: 'running' }))
      try {
        if (sink.type === 'write-table') {
          const d = sink.data as WriteTableNodeData
          const inputEdge = edgesRef.current.find((e) => e.target === sink.id && e.targetHandle === 'row-in')
          if (!inputEdge) throw new Error('No data input connected to Write Table')
          const sql = buildNodeSQL(inputEdge.source, nodesRef.current, edgesRef.current, inputEdge.sourceHandle ?? undefined)
          if (!sql) throw new Error('Could not build upstream SQL for Write Table')
          const result = await window.api.pgWrite(d.resolvedConfig!, sql, d.tableName, d.writeMode)
          showToast(`✓ Wrote ${result.rowCount.toLocaleString()} rows → ${d.tableName}`)
        } else if (sink.type === 'csv-output') {
          const d = sink.data as CSVOutputNodeData
          const sql = buildNodeSQL(sink.id, nodesRef.current, edgesRef.current)
          if (!sql) throw new Error('Could not build SQL for CSV Export')
          const hasKnownPath = Boolean(d.outputPath && d.outputPath.trim())
          const delimChar = d.delimiter === 'semicolon' ? ';'
            : d.delimiter === 'pipe' ? '|'
            : d.delimiter === 'tab' ? '\t'
            : ','
          const result = await window.api.exportCSV(
            sql,
            delimChar,
            d.includeHeader,
            hasKnownPath ? d.outputPath : undefined,
            hasKnownPath
          )
          if (!result) {
            // User cancelled the save dialog — reset this node to idle
            setNodeExecState((s) => ({ ...s, [sink.id]: 'idle' }))
            continue
          }
          setNodes((ns) => ns.map((n) =>
            n.id === sink.id
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    outputPath: result.filePath,
                    lastExport: { rowCount: result.rowCount, timestamp: new Date().toLocaleTimeString() },
                  },
                }
              : n
          ))
          showToast(`✓ Exported ${result.rowCount?.toLocaleString() ?? '?'} rows`)
        }
        setNodeExecState((s) => ({ ...s, [sink.id]: 'done' }))
      } catch (err) {
        setNodeExecState((s) => ({ ...s, [sink.id]: 'error' }))
        showToast(`✗ ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    setIsExecuting(false)
    // Hold the done/error state for 2.5 s so the user can see the result, then clear
    setTimeout(() => setNodeExecState({}), 2500)
  }, [showToast])

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="app-layout">
      {/* Top bar */}
      <header className="topbar">
        <span className="topbar-title">Pipelines</span>

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
            className="topbar-btn topbar-btn-run"
            onClick={executePipeline}
            disabled={isExecuting || nodes.length === 0}
            title="Run all output nodes (Write Table + CSV Export)"
          >
            {isExecuting
              ? <><Loader size={13} strokeWidth={1.75} className="spin" />Running…</>
              : <><Play size={13} strokeWidth={1.75} />Run</>}
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
            <PreviewDrawer
              nodeLabel={nodeLabel(nodes.find((n) => n.id === previewNodeId))}
              result={previewResult}
              loading={previewLoading}
              error={previewError}
              onClose={() => setPreviewNodeId(null)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
