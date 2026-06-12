/**
 * Shared IPC contract — the single source of truth for every type that crosses
 * a process boundary (main ⇄ preload ⇄ renderer).
 *
 * - main/index.ts imports the result types its handlers return.
 * - preload/index.ts implements `PipelinesApi` (a type error there means the
 *   bridge drifted from this contract).
 * - renderer's env.d.ts declares `window.api: PipelinesApi`.
 *
 * Keep this file dependency-free (no electron / node / react imports) so all
 * three tsconfig projects can include it.
 */

// ── Data shapes ────────────────────────────────────────────────────────────────

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
  rowCount: number | null
}

export interface ExportResult {
  filePath: string
  rowCount: number | null
}

export interface ReportColumnStat {
  name: string
  type: string
  nonNull: number
  distinct: number
  min: string | null
  max: string | null
  blank: number
  top: { value: string | null; count: number }[]
}

export interface ReportResult {
  rowCount: number
  columns: ReportColumnStat[]
}

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

export interface PgWriteResult {
  rowCount: number
}

export interface PgWriteTarget {
  schema: string | null
  table: string
}

export interface TableEntry {
  schema: string
  name: string
}

export interface MaterializeResult {
  parquetPath: string
  columns: ColumnInfo[]
}

export interface ProjectLoadResult {
  path: string
  data: string
}

export interface ApiFetchResult {
  jsonPath: string
  columns: ColumnInfo[]
  rowCount: number
}

export interface ApiAuthResult {
  token: string
}

export interface ApiPaginatedResult {
  jsonPath: string
  columns: ColumnInfo[]
  rowCount: number
  pagesFetched: number
  hadErrors: boolean
}

export interface ApiFetchParams {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  upstreamSQL?: string
  nodeId: string
}

export interface ApiAuthParams {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  tokenPath: string
}

export interface ApiPaginatedParams {
  url: string
  headers: Record<string, string>
  strategy: 'page' | 'offset' | 'cursor' | 'link-header'
  pageParam?: string
  pageStart?: number
  offsetParam?: string
  limitParam?: string
  limitValue?: number
  cursorPath?: string
  cursorParam?: string
  cursorIn?: 'query' | 'body'
  dataPath?: string
  maxPages?: number
  failOnError?: boolean
  nodeId: string
}

// ── Execution cancellation ─────────────────────────────────────────────────────

/**
 * Marker carried in the message of errors thrown when a long-running main
 * handler (pg:write, api:paginated) is cancelled mid-step. Electron wraps
 * handler rejections ("Error invoking remote method '…': Error: …"), so the
 * renderer must detect by substring, not equality — use isCancelledError.
 */
export const EXEC_CANCELLED = 'PIPELINES_EXEC_CANCELLED'

export function isCancelledError(err: unknown): boolean {
  return String(err).includes(EXEC_CANCELLED)
}

// ── The bridge contract ────────────────────────────────────────────────────────

export interface PgExecQueryResult {
  rowCount: number | null
}

export interface PipelinesApi {
  // CSV / JSON / files
  selectCSV: () => Promise<CSVSelectResult | null>
  selectJSON: () => Promise<CSVSelectResult | null>
  exportCSV: (
    sql: string,
    delimiter?: string,
    includeHeader?: boolean,
    defaultPath?: string,
    skipDialogIfDefaultPath?: boolean
  ) => Promise<ExportResult | null>
  pickCSVPath: (defaultPath?: string) => Promise<string | null>
  selectFileBase64: (
    filters?: { name: string; extensions: string[] }[]
  ) => Promise<{ filePath: string; fileName: string; base64: string } | null>
  rowsToBase64: (sql: string) => Promise<{ base64: string; rowCount: number }>

  // DuckDB
  dbPreview: (sql: string) => Promise<PreviewResult>
  dbProfile: (sql: string, columns: ColumnInfo[], topN?: number) => Promise<ReportResult>
  materializeRun: (sql: string, existingPath?: string) => Promise<MaterializeResult>

  // Project files
  saveProject: (data: string) => Promise<string | null>
  saveToPath: (path: string, data: string) => Promise<void>
  loadProject: () => Promise<ProjectLoadResult | null>
  loadFromPath: (path: string) => Promise<ProjectLoadResult | null>
  getLastFilePath: () => Promise<string | null>
  setLastFilePath: (path: string) => Promise<void>

  // Secrets (Electron safeStorage; null when encryption is unavailable)
  secureEncrypt: (plain: string) => Promise<string | null>
  secureDecrypt: (encrypted: string) => Promise<string | null>

  // PostgreSQL
  pgTest: (config: PgConfig) => Promise<{ ok: boolean; error?: string }>
  pgFetch: (config: PgConfig, query: string) => Promise<PgFetchResult>
  pgFetchCached: (config: PgConfig, query: string, force: boolean) => Promise<PgFetchResult>
  pgClearCache: (csvPath: string) => Promise<void>
  pgWrite: (
    config: PgConfig,
    sql: string,
    target: PgWriteTarget,
    writeMode: string
  ) => Promise<PgWriteResult>
  onPgWriteProgress: (cb: (written: number, total: number) => void) => void
  offPgWriteProgress: () => void
  pgListTables: (config: PgConfig) => Promise<TableEntry[]>
  pgDescribeTable: (config: PgConfig, schema: string, table: string) => Promise<ColumnInfo[]>

  pgUpdateRows: (
    config: PgConfig,
    sql: string,
    target: PgWriteTarget,
    pkColumn: string,
    updateColumns: string[]
  ) => Promise<{ rowCount: number }>
  onPgUpdateProgress: (cb: (written: number, total: number) => void) => void
  offPgUpdateProgress: () => void
  pgExecQuery: (config: PgConfig, sql: string) => Promise<PgExecQueryResult>

  // HTTP API nodes
  apiFetch: (params: ApiFetchParams) => Promise<ApiFetchResult>
  apiAuth: (params: ApiAuthParams) => Promise<ApiAuthResult>
  apiPaginated: (params: ApiPaginatedParams) => Promise<ApiPaginatedResult>

  // Execution control — aborts the in-flight cancellable operation (pg:write,
  // api:paginated); it rejects with an EXEC_CANCELLED error.
  execCancel: () => Promise<void>
}
