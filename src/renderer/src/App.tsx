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
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { FolderOpen, Save } from 'lucide-react'

import { v4 as uuid } from 'uuid'
import { buildNodeSQL, getNodeOutputColumns } from './lib/sqlBuilder'
import type {
  AppNode, AppEdge,
  CSVNodeData, JoinNodeData, TransformNodeData, DestinationNodeData, CSVOutputNodeData,
  MergeNodeData, FilterNodeData, StaticValueData, IncrementValueData,
  UniqueNodeData, MapValueData, ConditionalOutputData,
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
  if (tgt === 'anchor-in')        return 'row-edge anchor-edge'
  if (src === 'row-out-pass')     return 'row-edge row-edge-pass'
  if (src === 'row-out-fail')     return 'row-edge row-edge-fail'
  return 'row-edge'
}

// ── Position helper ───────────────────────────────────────────────────────────
let nodeCounter = 0
function nextPosition() {
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

// ── Column propagation through the graph ─────────────────────────────────────
function propagateColumns(nodes: AppNode[], edges: AppEdge[]): AppNode[] {
  return nodes.map((node) => {
    if (node.type === 'join') {
      const leftEdge  = edges.find((e) => e.target === node.id && e.targetHandle === 'row-left')
      const rightEdge = edges.find((e) => e.target === node.id && e.targetHandle === 'row-right')
      const leftCols  = leftEdge  ? getNodeOutputColumns(leftEdge.source,  nodes, edges) : []
      const rightCols = rightEdge ? getNodeOutputColumns(rightEdge.source, nodes, edges) : []
      const d = node.data as JoinNodeData
      const leftKey  = leftCols.find((c)  => c.name === d.leftKey)  ? d.leftKey  : ''
      const rightKey = rightCols.find((c) => c.name === d.rightKey) ? d.rightKey : ''
      return { ...node, data: { ...d, leftColumns: leftCols, rightColumns: rightCols, leftKey, rightKey } }
    }

    if (node.type === 'transform') {
      const inputEdge = edges.find((e) => e.target === node.id && e.targetHandle === 'row-in')
      const inputCols = inputEdge ? getNodeOutputColumns(inputEdge.source, nodes, edges) : []
      return { ...node, data: { ...node.data, inputColumns: inputCols } }
    }

    if (node.type === 'destination') {
      const inputEdge = edges.find((e) => e.target === node.id && e.targetHandle === 'row-in')
      const inputCols = inputEdge ? getNodeOutputColumns(inputEdge.source, nodes, edges) : []
      const d = node.data as DestinationNodeData
      const existingMap = d.colMap ?? []
      const colMap = inputCols.map((col) => {
        const existing = existingMap.find((m) => m.sourceCol === col.name)
        return existing ?? { sourceCol: col.name, destCol: col.name, included: true }
      })
      return { ...node, data: { ...d, inputColumns: inputCols, colMap } }
    }

    if (node.type === 'csv-output') {
      const inputEdge = edges.find((e) => e.target === node.id && e.targetHandle === 'row-in')
      const inputCols = inputEdge ? getNodeOutputColumns(inputEdge.source, nodes, edges) : []
      return { ...node, data: { ...node.data, inputColumns: inputCols } }
    }

    if (node.type === 'merge') {
      // Prefer left input; fall back to right if only right is connected
      const leftEdge  = edges.find((e) => e.target === node.id && e.targetHandle === 'row-left')
      const rightEdge = edges.find((e) => e.target === node.id && e.targetHandle === 'row-right')
      const srcEdge   = leftEdge ?? rightEdge
      const inputCols = srcEdge ? getNodeOutputColumns(srcEdge.source, nodes, edges) : []
      return { ...node, data: { ...node.data, inputColumns: inputCols } }
    }

    if (node.type === 'filter') {
      const inputEdge = edges.find((e) => e.target === node.id && e.targetHandle === 'row-in')
      const inputCols = inputEdge ? getNodeOutputColumns(inputEdge.source, nodes, edges) : []
      return { ...node, data: { ...node.data, inputColumns: inputCols } }
    }

    if (node.type === 'unique') {
      const inputEdge = edges.find((e) => e.target === node.id && e.targetHandle === 'row-in')
      const inputCols = inputEdge ? getNodeOutputColumns(inputEdge.source, nodes, edges) : []
      return { ...node, data: { ...node.data, inputColumns: inputCols } }
    }

    if (node.type === 'static-value' || node.type === 'increment-value'
      || node.type === 'map-value' || node.type === 'conditional-output') {
      const hasAnchor = edges.some((e) => e.target === node.id && e.targetHandle === 'anchor-in')
      return { ...node, data: { ...node.data, hasAnchor } }
    }

    return node
  })
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
  if (node.type === 'filter')          return 'Filter'
  if (node.type === 'static-value')        return 'Static Value'
  if (node.type === 'increment-value')     return 'Increment'
  if (node.type === 'unique')              return 'Unique'
  if (node.type === 'map-value')           return (node.data as MapValueData).columnName || 'Map'
  if (node.type === 'conditional-output')  return (node.data as ConditionalOutputData).columnName || 'Conditional'
  return ''
}

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
        || tgt === 'val-in' || tgt === 'anchor-in'
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
    const srcCol = src.startsWith('col-out-') || src === 'col-out'
    const tgtCol = tgt.startsWith('col-in-')
    return (srcRow && tgtRow) || (srcCol && tgtCol)
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
          id: uuid(), type: 'csv-input', position: nextPosition(),
          data: { fileName: result.fileName, filePath: result.filePath, columns: result.columns } satisfies CSVNodeData,
        }])
        break
      }
      case 'join':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'join', position: nextPosition(),
          data: { joinType: 'INNER', leftKey: '', rightKey: '', leftColumns: [], rightColumns: [] } satisfies JoinNodeData,
        }])
        break
      case 'transform':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'transform', position: nextPosition(),
          data: { expressions: [], keepAll: true, inputColumns: [] } satisfies TransformNodeData,
        }])
        break
      case 'destination':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'destination', position: nextPosition(),
          data: { label: 'Output', inputColumns: [], colMap: [] } satisfies DestinationNodeData,
        }])
        break
      case 'csv-output':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'csv-output', position: nextPosition(),
          data: { outputPath: '', includeHeader: true, inputColumns: [], lastExport: null, delimiter: 'comma' } satisfies CSVOutputNodeData,
        }])
        break
      case 'merge':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'merge', position: nextPosition(),
          data: { inputColumns: [] } satisfies MergeNodeData,
        }])
        break
      case 'filter':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'filter', position: nextPosition(),
          data: { condition: '', inputColumns: [] } satisfies FilterNodeData,
        }])
        break
      case 'static-value':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'static-value', position: nextPosition(),
          data: { columnName: 'value', value: '', hasAnchor: false } satisfies StaticValueData,
        }])
        break
      case 'increment-value':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'increment-value', position: nextPosition(),
          data: { columnName: 'index', startAt: 1, hasAnchor: false } satisfies IncrementValueData,
        }])
        break
      case 'unique':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'unique', position: nextPosition(),
          data: { keyColumn: '', keep: 'first', inputColumns: [] } satisfies UniqueNodeData,
        }])
        break
      case 'map-value':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'map-value', position: nextPosition(),
          data: { columnName: 'mapped', sourceColumn: '', mappings: [], hasAnchor: false } satisfies MapValueData,
        }])
        break
      case 'conditional-output':
        setNodes((ns) => [...ns, {
          id: uuid(), type: 'conditional-output', position: nextPosition(),
          data: { columnName: 'result', conditions: [], fallback: '', hasAnchor: false } satisfies ConditionalOutputData,
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
    const raw = await window.api.loadProject()
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as { version: number; nodes: AppNode[]; edges: AppEdge[] }
      if (!parsed.nodes || !parsed.edges) throw new Error('Invalid file format')
      nodeCounter = parsed.nodes.length
      setNodes(parsed.nodes)
      setEdges(parsed.edges)
      setCurrentFilePath(null) // loaded file doesn't track a save path (would need to store it in the .pipes file)
      showToast('Pipeline loaded')
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
        </div>
      </header>

      <div className="app-body">
        <Sidebar onAdd={handleSidebarAdd} />

        <div className="canvas-wrap">
          <ReactFlow
            nodes={nodes}
            edges={displayEdges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            isValidConnection={isValidConnection}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            deleteKeyCode="Delete"
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
