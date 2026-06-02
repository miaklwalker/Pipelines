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

export interface JoinColSelection {
  side: 'left' | 'right'
  name: string    // original column name in its source table
  alias: string   // output name (default: name for left, r_{name} for right)
  included: boolean
}

export interface JoinNodeData extends Record<string, unknown> {
  joinType: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL'
  leftKey: string
  rightKey: string
  leftColumns: ColumnInfo[]
  rightColumns: ColumnInfo[]
  /** Optional column-level output selection. Undefined = include all (legacy behaviour). */
  columnSelection?: JoinColSelection[]
}

export interface TransformNodeData extends Record<string, unknown> {
  expressions: Array<{ id: string; alias: string; expr: string }>
  keepAll: boolean
  inputColumns: ColumnInfo[]
}

export interface ColMapping {
  /** Upstream column name. Empty string = custom column created in the node. */
  sourceCol: string
  destCol: string
  included: boolean
  /** SQL expression used when sourceCol is empty (custom column). */
  customExpr?: string
}

export interface DestinationNodeData extends Record<string, unknown> {
  label: string
  colMap: ColMapping[]
  resolvedConfig?: PgConfig | null
  dbTables?: TableEntry[]
  dbSelectedSchema?: string | null
  dbSelectedTable?: string | null
  dbTargetColumns?: ColumnInfo[]
  dbStatus?: 'idle' | 'browsing' | 'loading' | 'ready' | 'error'
  dbError?: string
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

// ─── PostgreSQL types ────────────────────────────────────────────────────────

export interface PgConfig {
  host: string
  port: number
  database: string
  user: string
  password: string
  ssl: boolean
}

export interface PgFetchResult {
  csvPath: string
  columns: ColumnInfo[]
  rowCount: number
  fromCache?: boolean
  cacheDate?: string
}

export type DbReadMode = 'table' | 'sql'
export type DbWriteMode = 'append' | 'replace'

export interface ConnectionNodeData extends Record<string, unknown> {
  config: PgConfig
  testStatus: 'idle' | 'testing' | 'ok' | 'error'
  testError?: string
}

export interface ReadTableNodeData extends Record<string, unknown> {
  readMode: DbReadMode
  tableName: string
  customSQL: string
  csvPath: string | null
  columns: ColumnInfo[]
  rowCount: number | null
  status: 'idle' | 'fetching' | 'ready' | 'error'
  error?: string
  resolvedConfig?: PgConfig | null
}

export interface ReadTableCachedNodeData extends Record<string, unknown> {
  readMode: DbReadMode
  tableName: string
  customSQL: string
  csvPath: string | null
  columns: ColumnInfo[]
  rowCount: number | null
  status: 'idle' | 'fetching' | 'ready' | 'error'
  error?: string
  resolvedConfig?: PgConfig | null
  cacheDate: string | null
}

export interface WriteTableNodeData extends Record<string, unknown> {
  tableName: string
  writeMode: DbWriteMode
  status: 'idle' | 'writing' | 'done' | 'error'
  rowCount: number | null
  error?: string
  resolvedConfig?: PgConfig | null
  inputColumns: ColumnInfo[]
}

export interface SortKey { column: string; direction: 'ASC' | 'DESC' }

export interface SortNodeData extends Record<string, unknown> {
  sortKeys: SortKey[]
  inputColumns: ColumnInfo[]
}

export interface LimitNodeData extends Record<string, unknown> {
  count: number
  offset: number
}

export type AggFunc = 'COUNT' | 'COUNT_DISTINCT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'
export interface AggItem { id: string; func: AggFunc; column: string; alias: string }
export interface AggregateNodeData extends Record<string, unknown> {
  groupBy: string[]
  aggregations: AggItem[]
  inputColumns: ColumnInfo[]
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

// ─── Schema browser ──────────────────────────────────────────────────────────

export interface TableEntry {
  schema: string
  name: string
}

export interface BrowseSchemaNodeData extends Record<string, unknown> {
  tables: TableEntry[]
  selectedSchema: string | null
  selectedTable: string | null
  filter: string
  csvPath: string | null
  columns: ColumnInfo[]
  rowCount: number | null
  status: 'idle' | 'browsing' | 'fetching' | 'ready' | 'error'
  error?: string
  resolvedConfig?: PgConfig | null
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
  | Node<SortNodeData,            'sort'>
  | Node<LimitNodeData,           'limit'>
  | Node<AggregateNodeData,       'aggregate'>
  | Node<ConnectionNodeData,      'connection'>
  | Node<ReadTableNodeData,       'read-table'>
  | Node<ReadTableCachedNodeData, 'read-table-cached'>
  | Node<WriteTableNodeData,      'write-table'>
  | Node<BrowseSchemaNodeData,    'browse-schema'>

export type AppEdge = Edge
