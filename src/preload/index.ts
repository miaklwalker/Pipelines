import { contextBridge, ipcRenderer } from 'electron'

export type ColumnInfo      = { name: string; type: string }
export type CSVSelectResult = { filePath: string; fileName: string; columns: ColumnInfo[] }
export type JSONSelectResult = { filePath: string; fileName: string; columns: ColumnInfo[] }
export type PreviewResult   = { columns: string[]; rows: (string | null)[][]; rowCount: number | null }
export type ExportResult    = { filePath: string; rowCount: number | null }
export type PgConfig        = { host: string; port: number; database: string; user: string; password: string; ssl: boolean }
export type PgFetchResult   = { csvPath: string; columns: ColumnInfo[]; rowCount: number; fromCache?: boolean; cacheDate?: string }
export type PgWriteResult   = { rowCount: number }
export type TableEntry      = { schema: string; name: string }
export type MaterializeResult = { parquetPath: string; columns: ColumnInfo[] }
export type ProjectLoadResult = { path: string; data: string }

const api = {
  // CSV
  selectCSV: (): Promise<CSVSelectResult | null> => ipcRenderer.invoke('csv:select'),
  selectJSON: (): Promise<JSONSelectResult | null> => ipcRenderer.invoke('json:select'),
  exportCSV: (sql: string, delimiter?: string, includeHeader?: boolean, defaultPath?: string, skipDialogIfDefaultPath?: boolean): Promise<ExportResult | null> =>
    ipcRenderer.invoke('csv:export', { sql, delimiter, includeHeader, defaultPath, skipDialogIfDefaultPath }),
  pickCSVPath: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('csv:pick-path', { defaultPath }),
  // DuckDB preview
  dbPreview: (sql: string): Promise<PreviewResult> => ipcRenderer.invoke('db:preview', { sql }),
  // Materialize
  materializeRun: (sql: string, existingPath?: string): Promise<MaterializeResult> => ipcRenderer.invoke('materialize:run', { sql, existingPath }),
  // Project
  saveProject: (data: string): Promise<string | null> => ipcRenderer.invoke('project:save', { data }),
  saveToPath: (path: string, data: string): Promise<void> => ipcRenderer.invoke('project:saveToPath', { path, data }),
  loadProject: (): Promise<ProjectLoadResult | null> => ipcRenderer.invoke('project:load'),
  // PostgreSQL
  pgTest: (config: PgConfig): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('pg:test', config),
  pgFetch: (config: PgConfig, query: string): Promise<PgFetchResult> => ipcRenderer.invoke('pg:fetch', config, query),
  pgFetchCached: (config: PgConfig, query: string, force: boolean): Promise<PgFetchResult> => ipcRenderer.invoke('pg:fetch-cached', config, query, force),
  pgClearCache: (csvPath: string): Promise<void> => ipcRenderer.invoke('pg:clear-cache', csvPath),
  pgWrite: (config: PgConfig, sql: string, tableName: string, writeMode: string): Promise<PgWriteResult> => ipcRenderer.invoke('pg:write', config, sql, tableName, writeMode),
  pgListTables: (config: PgConfig): Promise<TableEntry[]> => ipcRenderer.invoke('pg:list-tables', config),
  pgDescribeTable: (config: PgConfig, schema: string, table: string): Promise<ColumnInfo[]> => ipcRenderer.invoke('pg:describe-table', config, schema, table),
}

contextBridge.exposeInMainWorld('api', api)

declare global {
  interface Window { api: typeof api }
}
