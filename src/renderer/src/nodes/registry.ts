import type { ComponentType } from 'react'

// ── Port descriptor ────────────────────────────────────────────────────────────
export type PortDef = { type: 'row' | 'col' | 'conn'; label?: string }

// ── Per-node help content ──────────────────────────────────────────────────────
export interface NodeHelp {
  summary: string
  inputs?: string
  outputs?: string
  tips?: string[]
}

// ── Node definition ────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface NodeDef<D = any> {
  /** ReactFlow node type key */
  type: string
  /** Sidebar grouping */
  category: 'input' | 'operation' | 'output' | 'emitter' | 'database'
  /** Display name */
  name: string
  /** One-line description shown in the sidebar */
  desc: string
  /** Lucide icon component */
  Icon: ComponentType<any>
  /** Inline help dossier content */
  help: NodeHelp
  /** Sidebar port indicators (input side) */
  inputPorts: PortDef[]
  /** Sidebar port indicators (output side) */
  outputPorts: PortDef[]
  /** Factory for the initial node data object */
  defaultData: () => D
  /** If true, a gear icon appears in the node header and sidebar card */
  hasAdvanced?: boolean
  /** The React component rendered on the canvas */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: ComponentType<any>
}

// ── Internal registry ──────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry = new Map<string, NodeDef<any>>()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerNode(def: NodeDef<any>): void {
  registry.set(def.type, def)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getNodeDef(type: string): NodeDef<any> | undefined {
  return registry.get(type)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getAllDefs(): NodeDef<any>[] {
  return [...registry.values()]
}

/** Build the stable nodeTypes map for ReactFlow — call once after all nodes are registered */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildNodeTypes(): Record<string, ComponentType<any>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const types: Record<string, ComponentType<any>> = {}
  for (const [type, def] of registry.entries()) {
    types[type] = def.Component
  }
  return types
}
