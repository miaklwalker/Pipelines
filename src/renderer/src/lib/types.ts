import type { Node, Edge } from '@xyflow/react'

export interface ColumnInfo {
  name: string
  type: string
}

export interface CSVSelectResult {
  filePath: string
  fileName: string
  columns: ColumnInfo[]
}

export interface PreviewResult {
  columns: string[]
  rows: (string | null)[][]
}

export interface ExportResult {
  filePath: string
  rowCount: number | null
}

// ─── Node data shapes ────────────────────────────────────────────────────────

export interface CSVNodeData extends Record<string, unknown> {
  fileName: string
  filePath: string
  columns: ColumnInfo[]
}

export interface JoinNodeData extends Record<string, unknown> {
  joinType: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL'
  leftKey: string
  rightKey: string
  leftColumns: ColumnInfo[]
  rightColumns: ColumnInfo[]
}

export interface TransformNodeData extends Record<string, unknown> {
  expressions: Array<{ id: string; alias: string; expr: string }>
  keepAll: boolean
  inputColumns: ColumnInfo[]
}

export interface ColMapping {
  sourceCol: string
  destCol: string
  included: boolean
}

export interface DestinationNodeData extends Record<string, unknown> {
  label: string
  inputColumns: ColumnInfo[]
  colMap: ColMapping[]
}

export interface CSVOutputNodeData extends Record<string, unknown> {
  outputPath: string
  includeHeader: boolean
  inputColumns: ColumnInfo[]
  lastExport: { rowCount: number | null; timestamp: string } | null
  delimiter?: string
}

export interface MergeNodeData extends Record<string, unknown> {
  inputColumns: ColumnInfo[]   // columns from left input (both sides must match)
}

export interface FilterNodeData extends Record<string, unknown> {
  condition: string            // SQL boolean expression for the WHERE clause
  inputColumns: ColumnInfo[]
}

export interface StaticValueData extends Record<string, unknown> {
  columnName: string           // name of the emitted column
  value: string                // the literal value to emit for every row
  hasAnchor?: boolean          // true when an anchor row stream is connected
}

export interface IncrementValueData extends Record<string, unknown> {
  columnName: string           // name of the emitted column
  startAt: number              // first value (default 1)
  hasAnchor?: boolean
}

export interface UniqueNodeData extends Record<string, unknown> {
  keyColumn: string            // column to deduplicate on
  keep: 'first' | 'last'      // which occurrence to keep
  inputColumns: ColumnInfo[]
}

export interface MapValueData extends Record<string, unknown> {
  columnName: string           // output column name wired to Destination
  sourceColumn: string         // upstream column whose value is looked up
  mappings: Array<{ from: string; to: string }>
  hasAnchor?: boolean
}

export interface ConditionalOutputData extends Record<string, unknown> {
  columnName: string           // output column name wired to Destination
  conditions: Array<{ condition: string; output: string }>
  fallback: string             // ELSE value (empty = NULL)
  hasAnchor?: boolean
}

// ─── Union node type ─────────────────────────────────────────────────────────

export type AppNode =
  | Node<CSVNodeData,            'csv-input'>
  | Node<JoinNodeData,           'join'>
  | Node<TransformNodeData,      'transform'>
  | Node<DestinationNodeData,    'destination'>
  | Node<CSVOutputNodeData,      'csv-output'>
  | Node<MergeNodeData,          'merge'>
  | Node<FilterNodeData,         'filter'>
  | Node<StaticValueData,        'static-value'>
  | Node<IncrementValueData,     'increment-value'>
  | Node<UniqueNodeData,         'unique'>
  | Node<MapValueData,           'map-value'>
  | Node<ConditionalOutputData,  'conditional-output'>

export type AppEdge = Edge
