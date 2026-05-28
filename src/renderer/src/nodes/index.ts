// Import each node file for its side-effect: registerNode() call.
// Order determines the registry insertion order (used by Sidebar grouping).
import './CSVInputNode'
import './JoinNode'
import './TransformNode'
import './DestinationNode'
import './CSVOutputNode'
import './MergeNode'
import './FilterNode'
import './StaticValueNode'
import './IncrementValueNode'

// Build the stable ReactFlow nodeTypes map once, after all nodes are registered.
import { buildNodeTypes } from './registry'
export const NODE_TYPES = buildNodeTypes()

// Re-export registry utilities for consumers (Sidebar, App, etc.)
export { getAllDefs, getNodeDef } from './registry'
export type { NodeDef, PortDef } from './registry'
